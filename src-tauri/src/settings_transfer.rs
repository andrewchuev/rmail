use std::collections::HashSet;
use std::fs;
use std::path::Path;

use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use chacha20poly1305::{
    XChaCha20Poly1305, XNonce,
    aead::{Aead, Generate, KeyInit, Payload as AeadPayload},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::google_oauth;
use crate::storage::{CreateAccountInput, Database};

const FORMAT: &str = "rmail-settings";
const FORMAT_VERSION: u32 = 1;
const AAD: &[u8] = b"rmail-settings/v1";
const MIN_PASSPHRASE_CHARS: usize = 8;

// Argon2id cost used for new exports; imports accept anything up to the limits below
// so files stay readable if the defaults are raised later.
const KDF_MEMORY_KIB: u32 = 64 * 1024;
const KDF_ITERATIONS: u32 = 3;
const KDF_PARALLELISM: u32 = 1;
const MAX_KDF_MEMORY_KIB: u32 = 512 * 1024;
const MAX_KDF_ITERATIONS: u32 = 10;
const MAX_KDF_PARALLELISM: u32 = 8;

const WRONG_PASSPHRASE: &str = "Incorrect password or the file is damaged.";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KdfParams {
    algorithm: String,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
    salt: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    format: String,
    version: u32,
    kdf: KdfParams,
    cipher: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountEntry {
    pub email: String,
    pub display_name: String,
    pub imap_host: String,
    pub smtp_host: String,
    pub auth_type: String,
    pub notifications_enabled: bool,
    pub password: Option<String>,
    pub refresh_token: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPayload {
    pub app_preferences: Value,
    pub notification_exclusions: Vec<String>,
    pub accounts: Vec<AccountEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSummary {
    pub accounts: usize,
    pub accounts_without_secret: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub app_preferences: Value,
    pub accounts_added: usize,
    pub accounts_skipped: usize,
    pub exclusions_added: usize,
    pub failures: Vec<String>,
}

pub fn validate_passphrase(passphrase: &str) -> Result<(), String> {
    if passphrase.chars().count() < MIN_PASSPHRASE_CHARS {
        return Err(format!(
            "Use a password of at least {MIN_PASSPHRASE_CHARS} characters."
        ));
    }
    Ok(())
}

fn derive_key(passphrase: &str, kdf: &KdfParams, salt: &[u8]) -> Result<[u8; 32], String> {
    if kdf.algorithm != "argon2id" {
        return Err("Unsupported settings file.".to_string());
    }
    if kdf.memory_kib > MAX_KDF_MEMORY_KIB
        || kdf.iterations > MAX_KDF_ITERATIONS
        || kdf.parallelism > MAX_KDF_PARALLELISM
    {
        return Err("Unsupported settings file.".to_string());
    }
    let params = Params::new(kdf.memory_kib, kdf.iterations, kdf.parallelism, Some(32))
        .map_err(|_| "Unsupported settings file.".to_string())?;
    let mut key = [0u8; 32];
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(passphrase.as_bytes(), salt, &mut key)
        .map_err(|_| "Unable to derive the encryption key.".to_string())?;
    Ok(key)
}

pub fn encrypt_payload(payload: &SettingsPayload, passphrase: &str) -> Result<String, String> {
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).map_err(|error| error.to_string())?;
    let kdf = KdfParams {
        algorithm: "argon2id".to_string(),
        memory_kib: KDF_MEMORY_KIB,
        iterations: KDF_ITERATIONS,
        parallelism: KDF_PARALLELISM,
        salt: BASE64.encode(salt),
    };
    let key = derive_key(passphrase, &kdf, &salt)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|error| error.to_string())?;
    let nonce = XNonce::generate();
    let plaintext = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    let ciphertext = cipher
        .encrypt(
            &nonce,
            AeadPayload {
                msg: &plaintext,
                aad: AAD,
            },
        )
        .map_err(|_| "Unable to encrypt the settings.".to_string())?;

    serde_json::to_string_pretty(&Envelope {
        format: FORMAT.to_string(),
        version: FORMAT_VERSION,
        kdf,
        cipher: "xchacha20poly1305".to_string(),
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(ciphertext),
    })
    .map_err(|error| error.to_string())
}

pub fn decrypt_payload(contents: &str, passphrase: &str) -> Result<SettingsPayload, String> {
    let envelope: Envelope = serde_json::from_str(contents)
        .map_err(|_| "This is not an RMail settings file.".to_string())?;
    if envelope.format != FORMAT {
        return Err("This is not an RMail settings file.".to_string());
    }
    if envelope.version != FORMAT_VERSION || envelope.cipher != "xchacha20poly1305" {
        return Err("This settings file was created by a newer version of RMail.".to_string());
    }

    let decode = |value: &str| BASE64.decode(value).map_err(|_| WRONG_PASSPHRASE.to_string());
    let salt = decode(&envelope.kdf.salt)?;
    let nonce_bytes = decode(&envelope.nonce)?;
    let ciphertext = decode(&envelope.ciphertext)?;

    let key = derive_key(passphrase, &envelope.kdf, &salt)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key).map_err(|error| error.to_string())?;
    let nonce =
        XNonce::try_from(nonce_bytes.as_slice()).map_err(|_| WRONG_PASSPHRASE.to_string())?;
    let plaintext = cipher
        .decrypt(
            &nonce,
            AeadPayload {
                msg: &ciphertext,
                aad: AAD,
            },
        )
        .map_err(|_| WRONG_PASSPHRASE.to_string())?;
    serde_json::from_slice(&plaintext).map_err(|_| WRONG_PASSPHRASE.to_string())
}

pub fn write_private_file(path: &Path, contents: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .map_err(|error| error.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(unix))]
    {
        fs::write(path, contents).map_err(|error| error.to_string())
    }
}

pub fn collect_payload(
    database: &Database,
    app_preferences: Value,
) -> Result<SettingsPayload, String> {
    let accounts = database
        .list_accounts()?
        .into_iter()
        .map(|account| {
            let (password, refresh_token) = if account.auth_type == "gmail_oauth" {
                (None, google_oauth::load_refresh_token(&account.email)?)
            } else {
                (crate::stored_password(account.id).ok(), None)
            };
            Ok(AccountEntry {
                email: account.email,
                display_name: account.display_name,
                imap_host: account.imap_host,
                smtp_host: account.smtp_host,
                auth_type: account.auth_type,
                notifications_enabled: account.notifications_enabled,
                password,
                refresh_token,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let notification_exclusions = database
        .list_notification_exclusions()?
        .into_iter()
        .map(|exclusion| exclusion.sender)
        .collect();

    Ok(SettingsPayload {
        app_preferences,
        notification_exclusions,
        accounts,
    })
}

pub fn summarize_export(payload: &SettingsPayload) -> ExportSummary {
    ExportSummary {
        accounts: payload.accounts.len(),
        accounts_without_secret: payload
            .accounts
            .iter()
            .filter(|account| account.password.is_none() && account.refresh_token.is_none())
            .count(),
    }
}

/// Merges the payload into the local database: accounts whose email already
/// exists are left untouched, everything else is added together with its secret.
pub fn apply_payload(database: &Database, payload: SettingsPayload) -> Result<ImportSummary, String> {
    let mut known_emails: HashSet<String> = database
        .list_accounts()?
        .into_iter()
        .map(|account| account.email.to_lowercase())
        .collect();
    let mut accounts_added = 0;
    let mut accounts_skipped = 0;
    let mut failures = Vec::new();

    for entry in payload.accounts {
        let email_key = entry.email.trim().to_lowercase();
        if !known_emails.insert(email_key) {
            accounts_skipped += 1;
            continue;
        }
        match add_account(database, &entry) {
            Ok(()) => accounts_added += 1,
            Err(error) => failures.push(format!("{}: {}", entry.email, error)),
        }
    }

    let mut exclusions_added = 0;
    for sender in &payload.notification_exclusions {
        if database.add_notification_exclusion(sender).is_ok() {
            exclusions_added += 1;
        }
    }

    Ok(ImportSummary {
        app_preferences: payload.app_preferences,
        accounts_added,
        accounts_skipped,
        exclusions_added,
        failures,
    })
}

fn add_account(database: &Database, entry: &AccountEntry) -> Result<(), String> {
    let account = if entry.auth_type == "gmail_oauth" {
        database.create_gmail_account(&entry.email, &entry.display_name)?
    } else {
        database.create_account(CreateAccountInput {
            email: entry.email.clone(),
            display_name: entry.display_name.clone(),
            imap_host: entry.imap_host.clone(),
            smtp_host: entry.smtp_host.clone(),
        })?
    };

    let stored = if entry.auth_type == "gmail_oauth" {
        match &entry.refresh_token {
            Some(token) => google_oauth::store_refresh_token(&account.email, token),
            None => Ok(()),
        }
    } else {
        match &entry.password {
            Some(password) => crate::write_password(account.id, password),
            None => Ok(()),
        }
    };
    if let Err(error) = stored {
        let _ = database.delete_account(account.id);
        return Err(error);
    }

    database.set_account_notifications(account.id, entry.notifications_enabled)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> SettingsPayload {
        SettingsPayload {
            app_preferences: serde_json::json!({ "ui-theme": "dark", "ui-zoom-level": "1.1" }),
            notification_exclusions: vec!["noreply@example.com".to_string()],
            accounts: vec![AccountEntry {
                email: "me@example.com".to_string(),
                display_name: "Me".to_string(),
                imap_host: "imap.example.com".to_string(),
                smtp_host: "smtp.example.com".to_string(),
                auth_type: "password".to_string(),
                notifications_enabled: true,
                password: Some("s3cret-pass".to_string()),
                refresh_token: None,
            }],
        }
    }

    #[test]
    fn round_trips_through_encryption() {
        let payload = sample_payload();
        let file = encrypt_payload(&payload, "correct horse").unwrap();
        assert!(!file.contains("s3cret-pass"));
        assert_eq!(decrypt_payload(&file, "correct horse").unwrap(), payload);
    }

    #[test]
    fn rejects_wrong_passphrase() {
        let file = encrypt_payload(&sample_payload(), "correct horse").unwrap();
        assert_eq!(
            decrypt_payload(&file, "battery staple").unwrap_err(),
            WRONG_PASSPHRASE
        );
    }

    #[test]
    fn rejects_tampered_ciphertext() {
        let file = encrypt_payload(&sample_payload(), "correct horse").unwrap();
        let mut envelope: Envelope = serde_json::from_str(&file).unwrap();
        let mut bytes = BASE64.decode(&envelope.ciphertext).unwrap();
        bytes[0] ^= 0x01;
        envelope.ciphertext = BASE64.encode(bytes);
        let tampered = serde_json::to_string(&envelope).unwrap();
        assert_eq!(
            decrypt_payload(&tampered, "correct horse").unwrap_err(),
            WRONG_PASSPHRASE
        );
    }

    #[test]
    fn rejects_files_that_are_not_rmail_settings() {
        assert_eq!(
            decrypt_payload("{\"hello\":1}", "correct horse").unwrap_err(),
            "This is not an RMail settings file."
        );
        assert_eq!(
            decrypt_payload("not json", "correct horse").unwrap_err(),
            "This is not an RMail settings file."
        );
    }

    #[test]
    fn rejects_excessive_kdf_cost() {
        let file = encrypt_payload(&sample_payload(), "correct horse").unwrap();
        let mut envelope: Envelope = serde_json::from_str(&file).unwrap();
        envelope.kdf.memory_kib = u32::MAX;
        let hostile = serde_json::to_string(&envelope).unwrap();
        assert_eq!(
            decrypt_payload(&hostile, "correct horse").unwrap_err(),
            "Unsupported settings file."
        );
    }

    #[test]
    fn merges_accounts_by_email_and_keeps_existing_ones() {
        let database = Database::in_memory().unwrap();
        database
            .create_account(CreateAccountInput {
                email: "me@example.com".to_string(),
                display_name: "Existing".to_string(),
                imap_host: "imap.example.com".to_string(),
                smtp_host: "smtp.example.com".to_string(),
            })
            .unwrap();

        let mut payload = sample_payload();
        payload.accounts[0].email = "ME@Example.com".to_string();
        payload.accounts[0].password = None;
        payload.accounts.push(AccountEntry {
            email: "other@example.com".to_string(),
            display_name: "Other".to_string(),
            notifications_enabled: false,
            ..payload.accounts[0].clone()
        });
        payload.notification_exclusions.push("not-an-address".to_string());

        let summary = apply_payload(&database, payload).unwrap();

        assert_eq!(summary.accounts_added, 1);
        assert_eq!(summary.accounts_skipped, 1);
        assert_eq!(summary.exclusions_added, 1);
        assert!(summary.failures.is_empty());
        let accounts = database.list_accounts().unwrap();
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0].display_name, "Existing");
        assert_eq!(accounts[1].email, "other@example.com");
        assert!(!accounts[1].notifications_enabled);
    }

    #[test]
    fn requires_a_reasonably_long_passphrase() {
        assert!(validate_passphrase("short").is_err());
        assert!(validate_passphrase("long enough").is_ok());
    }
}
