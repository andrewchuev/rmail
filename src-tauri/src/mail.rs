use std::time::Duration;

use async_native_tls::TlsConnector;
use futures_util::TryStreamExt;
use lettre::{transport::smtp::authentication::Credentials, AsyncSmtpTransport, Tokio1Executor};
use serde::{Deserialize, Serialize};
use tokio::{net::TcpStream, time::timeout};

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(15);
const MESSAGE_SYNC_LIMIT: u32 = 50;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailConnectionInput {
    pub imap_host: String,
    pub imap_port: u16,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailConnectionStatus {
    pub mailboxes: Vec<String>,
    pub smtp_ready: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxSnapshot {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSnapshot {
    pub uid: u32,
    pub sender: String,
    pub subject: String,
    pub date: String,
    pub is_read: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxSnapshot {
    pub mailboxes: Vec<MailboxSnapshot>,
    pub messages: Vec<MessageSnapshot>,
}

pub async fn test_connection(input: MailConnectionInput) -> Result<MailConnectionStatus, String> {
    let input = validate_input(input)?;
    let mailboxes = test_imap(&input).await?;
    let smtp_ready = test_smtp(&input).await?;

    Ok(MailConnectionStatus {
        mailboxes,
        smtp_ready,
    })
}

pub async fn sync_inbox(input: MailConnectionInput) -> Result<InboxSnapshot, String> {
    let input = validate_input(input)?;
    let mut session = connect_session(&input).await?;
    let mailboxes = within_timeout(
        session.list(None, Some("*")),
        "Unable to list IMAP mailboxes.",
    )
    .await?
    .try_collect::<Vec<_>>()
    .await
    .map_err(|_| "Unable to list IMAP mailboxes.".to_string())?
    .into_iter()
    .map(|mailbox| MailboxSnapshot {
        path: mailbox.name().to_string(),
    })
    .collect();

    let selected = within_timeout(session.select("INBOX"), "Unable to open the inbox.").await?;
    let messages = if selected.exists == 0 {
        Vec::new()
    } else {
        let start = selected
            .exists
            .saturating_sub(MESSAGE_SYNC_LIMIT - 1)
            .max(1);
        let sequence = format!("{start}:*");
        within_timeout(
            session.uid_fetch(sequence, "(UID FLAGS ENVELOPE RFC822.SIZE)"),
            "Unable to fetch inbox messages.",
        )
        .await?
        .try_collect::<Vec<_>>()
        .await
        .map_err(|_| "Unable to fetch inbox messages.".to_string())?
        .into_iter()
        .filter_map(snapshot_message)
        .collect()
    };

    let _ = session.logout().await;
    Ok(InboxSnapshot {
        mailboxes,
        messages,
    })
}

async fn test_imap(input: &MailConnectionInput) -> Result<Vec<String>, String> {
    let mut session = connect_session(input).await?;
    let mailboxes = within_timeout(
        session.list(None, Some("*")),
        "Unable to list IMAP mailboxes.",
    )
    .await?
    .try_collect::<Vec<_>>()
    .await
    .map_err(|_| "Unable to list IMAP mailboxes.".to_string())?
    .into_iter()
    .map(|mailbox| mailbox.name().to_string())
    .collect();

    let _ = session.logout().await;
    Ok(mailboxes)
}

async fn connect_session(
    input: &MailConnectionInput,
) -> Result<async_imap::Session<async_native_tls::TlsStream<TcpStream>>, String> {
    let stream = within_timeout(
        TcpStream::connect((input.imap_host.as_str(), input.imap_port)),
        "IMAP server is unavailable.",
    )
    .await?;
    let stream = within_timeout(
        TlsConnector::new().connect(&input.imap_host, stream),
        "Unable to establish a secure IMAP connection.",
    )
    .await?;
    let mut client = async_imap::Client::new(stream);

    within_timeout(client.read_response(), "IMAP server did not respond.")
        .await?
        .ok_or_else(|| "IMAP server closed the connection.".to_string())?;

    client
        .login(&input.username, &input.password)
        .await
        .map_err(|_| "Unable to authenticate with IMAP.".to_string())
}

fn snapshot_message(fetch: async_imap::types::Fetch) -> Option<MessageSnapshot> {
    let envelope = fetch.envelope()?;
    let uid = fetch.uid?;
    let sender = envelope
        .from
        .as_ref()
        .and_then(|addresses| addresses.first())
        .map(format_address)
        .unwrap_or_else(|| "Unknown sender".to_string());

    Some(MessageSnapshot {
        uid,
        sender,
        subject: envelope
            .subject
            .as_deref()
            .map(decode_header)
            .unwrap_or_else(|| "(No subject)".to_string()),
        date: envelope
            .date
            .as_deref()
            .map(decode_header)
            .unwrap_or_default(),
        is_read: fetch
            .flags()
            .any(|flag| matches!(flag, async_imap::types::Flag::Seen)),
    })
}

fn format_address(address: &async_imap::imap_proto::types::Address<'_>) -> String {
    if let Some(name) = address.name.as_deref() {
        return decode_header(name);
    }

    let mailbox = address
        .mailbox
        .as_deref()
        .map(decode_header)
        .unwrap_or_default();
    let host = address
        .host
        .as_deref()
        .map(decode_header)
        .unwrap_or_default();
    match (mailbox.is_empty(), host.is_empty()) {
        (false, false) => format!("{mailbox}@{host}"),
        (false, true) => mailbox,
        _ => "Unknown sender".to_string(),
    }
}

fn decode_header(value: &[u8]) -> String {
    String::from_utf8_lossy(value).trim().to_string()
}

async fn test_smtp(input: &MailConnectionInput) -> Result<bool, String> {
    let transport = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&input.smtp_host)
        .map_err(|_| "Invalid SMTP server address.".to_string())?
        .port(input.smtp_port)
        .credentials(Credentials::new(
            input.username.clone(),
            input.password.clone(),
        ))
        .build::<Tokio1Executor>();

    within_timeout(transport.test_connection(), "SMTP server is unavailable.").await
}

async fn within_timeout<T, E>(
    operation: impl std::future::Future<Output = Result<T, E>>,
    timeout_message: &str,
) -> Result<T, String>
where
    E: std::fmt::Debug,
{
    timeout(CONNECTION_TIMEOUT, operation)
        .await
        .map_err(|_| timeout_message.to_string())?
        .map_err(|_| timeout_message.to_string())
}

fn validate_input(input: MailConnectionInput) -> Result<MailConnectionInput, String> {
    let input = MailConnectionInput {
        imap_host: input.imap_host.trim().to_lowercase(),
        imap_port: input.imap_port,
        smtp_host: input.smtp_host.trim().to_lowercase(),
        smtp_port: input.smtp_port,
        username: input.username.trim().to_string(),
        password: input.password,
    };

    if !is_valid_host(&input.imap_host) || !is_valid_host(&input.smtp_host) {
        return Err("Enter valid IMAP and SMTP server addresses.".to_string());
    }

    if input.username.is_empty() || input.password.is_empty() {
        return Err("Enter an email address and password.".to_string());
    }

    Ok(input)
}

fn is_valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '.' || character == '-'
        })
}

#[cfg(test)]
mod tests {
    use super::{validate_input, MailConnectionInput};

    #[test]
    fn rejects_unsafe_server_names() {
        let result = validate_input(MailConnectionInput {
            imap_host: "imap.example.com/invalid".to_string(),
            imap_port: 993,
            smtp_host: "smtp.example.com".to_string(),
            smtp_port: 587,
            username: "person@example.com".to_string(),
            password: "secret".to_string(),
        });

        assert!(result.is_err());
    }
}
