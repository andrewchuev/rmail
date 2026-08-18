use std::{fs, path::Path, sync::Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::mail::{InboxSnapshot, MessageBody};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAccountInput {
    pub email: String,
    pub display_name: String,
    pub imap_host: String,
    pub smtp_host: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAccountInput {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    pub imap_host: String,
    pub smtp_host: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    pub imap_host: String,
    pub smtp_host: String,
    pub auth_type: String,
    pub notifications_enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMailbox {
    pub path: String,
    pub unread_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedMessage {
    pub account_id: i64,
    pub account_display_name: String,
    pub mailbox_path: String,
    pub uid: u32,
    pub sender: String,
    pub sender_email: String,
    pub subject: String,
    pub date: String,
    pub internal_date: i64,
    pub is_read: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDraftInput {
    pub id: Option<i64>,
    pub account_id: i64,
    pub recipients: String,
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub id: i64,
    pub recipients: String,
    pub subject: String,
    pub body: String,
    pub updated_at: String,
}

/// A sender email address excluded, across every account, from desktop
/// notifications and the tray unread indicator.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationExclusion {
    pub id: i64,
    pub sender: String,
}

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                tauri_plugin_log::log::error!("Database directory creation failed: {}", error);
                error.to_string()
            })?;
        }

        let database = Self {
            connection: Mutex::new(Connection::open(path).map_err(|error| {
                tauri_plugin_log::log::error!("Database connection failed: {}", error);
                error.to_string()
            })?),
        };
        
        if let Err(e) = database.initialize() {
            tauri_plugin_log::log::error!("Database initialization failed: {}", e);
            return Err(e);
        }

        Ok(database)
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT id, email, display_name, imap_host, smtp_host, auth_type, notifications_enabled
                 FROM accounts
                 ORDER BY created_at ASC",
            )
            .map_err(|error| error.to_string())?;
        let accounts = statement
            .query_map([], |row| {
                Ok(Account {
                    id: row.get(0)?,
                    email: row.get(1)?,
                    display_name: row.get(2)?,
                    imap_host: row.get(3)?,
                    smtp_host: row.get(4)?,
                    auth_type: row.get(5)?,
                    notifications_enabled: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        Ok(accounts)
    }

    pub fn get_account(&self, account_id: i64) -> Result<Account, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        connection
            .query_row(
                "SELECT id, email, display_name, imap_host, smtp_host, auth_type, notifications_enabled
                 FROM accounts WHERE id = ?1",
                params![account_id],
                |row| {
                    Ok(Account {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        display_name: row.get(2)?,
                        imap_host: row.get(3)?,
                        smtp_host: row.get(4)?,
                        auth_type: row.get(5)?,
                        notifications_enabled: row.get(6)?,
                    })
                },
            )
            .map_err(|_| "Account was not found.".to_string())
    }

    pub fn save_draft(&self, input: SaveDraftInput) -> Result<Draft, String> {
        let input = validate_draft(input)?;
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let id = if let Some(id) = input.id {
            let changed = connection
                .execute(
                    "UPDATE drafts SET recipients = ?1, subject = ?2, body = ?3, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?4 AND account_id = ?5",
                    params![input.recipients, input.subject, input.body, id, input.account_id],
                )
                .map_err(|error| error.to_string())?;
            if changed == 0 {
                return Err("Draft was not found.".to_string());
            }
            id
        } else {
            connection
                .execute(
                    "INSERT INTO drafts (account_id, recipients, subject, body) VALUES (?1, ?2, ?3, ?4)",
                    params![input.account_id, input.recipients, input.subject, input.body],
                )
                .map_err(|error| error.to_string())?;
            connection.last_insert_rowid()
        };

        connection
            .query_row(
                "SELECT id, recipients, subject, body, updated_at FROM drafts WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Draft {
                        id: row.get(0)?,
                        recipients: row.get(1)?,
                        subject: row.get(2)?,
                        body: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .map_err(|_| "Draft was not found.".to_string())
    }

    pub fn delete_draft(&self, draft_id: i64) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        connection
            .execute("DELETE FROM drafts WHERE id = ?1", params![draft_id])
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn list_cached_mailboxes(&self, account_id: i64) -> Result<Vec<CachedMailbox>, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT mailboxes.path,
                        COALESCE(SUM(CASE WHEN messages.is_read = 0 THEN 1 ELSE 0 END), 0) AS unread_count
                 FROM mailboxes
                 LEFT JOIN messages
                   ON messages.account_id = mailboxes.account_id
                  AND messages.mailbox_path = mailboxes.path
                 WHERE mailboxes.account_id = ?1
                 GROUP BY mailboxes.path
                 ORDER BY CASE WHEN mailboxes.path = 'INBOX' THEN 0 ELSE 1 END, mailboxes.path",
            )
            .map_err(|error| error.to_string())?;
        let mailboxes = statement
            .query_map(params![account_id], |row| {
                Ok(CachedMailbox {
                    path: row.get(0)?,
                    unread_count: row.get(1)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        Ok(mailboxes)
    }

    pub fn list_cached_messages(
        &self,
        account_id: i64,
        mailbox_path: &str,
    ) -> Result<Vec<CachedMessage>, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT messages.account_id, accounts.display_name, messages.mailbox_path,
                        messages.uid, messages.sender, messages.sender_email, messages.subject,
                        messages.date, messages.internal_date, messages.is_read
                 FROM messages
                 JOIN accounts ON accounts.id = messages.account_id
                 WHERE messages.account_id = ?1 AND messages.mailbox_path = ?2
                 ORDER BY messages.internal_date DESC, messages.uid DESC",
            )
            .map_err(|error| error.to_string())?;
        let messages = statement
            .query_map(params![account_id, mailbox_path], |row| {
                Ok(CachedMessage {
                    account_id: row.get(0)?,
                    account_display_name: row.get(1)?,
                    mailbox_path: row.get(2)?,
                    uid: row.get(3)?,
                    sender: row.get(4)?,
                    sender_email: row.get(5)?,
                    subject: row.get(6)?,
                    date: row.get(7)?,
                    internal_date: row.get(8)?,
                    is_read: row.get(9)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        Ok(messages)
    }

    pub fn list_unified_inbox(&self) -> Result<Vec<CachedMessage>, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT messages.account_id, accounts.display_name, messages.mailbox_path,
                        messages.uid, messages.sender, messages.sender_email, messages.subject,
                        messages.date, messages.internal_date, messages.is_read
                 FROM messages
                 JOIN accounts ON accounts.id = messages.account_id
                 WHERE messages.mailbox_path = 'INBOX' COLLATE NOCASE
                 ORDER BY messages.internal_date DESC, messages.account_id ASC, messages.uid DESC",
            )
            .map_err(|error| error.to_string())?;
        let messages = statement
            .query_map([], |row| {
                Ok(CachedMessage {
                    account_id: row.get(0)?,
                    account_display_name: row.get(1)?,
                    mailbox_path: row.get(2)?,
                    uid: row.get(3)?,
                    sender: row.get(4)?,
                    sender_email: row.get(5)?,
                    subject: row.get(6)?,
                    date: row.get(7)?,
                    internal_date: row.get(8)?,
                    is_read: row.get(9)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        Ok(messages)
    }

    pub fn get_cached_message_body(
        &self,
        account_id: i64,
        mailbox_path: &str,
        uid: u32,
    ) -> Result<Option<MessageBody>, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let text = connection
            .query_row(
                "SELECT body FROM message_bodies
                 WHERE account_id = ?1 AND mailbox_path = ?2 AND uid = ?3",
                params![account_id, mailbox_path, uid],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                error => Err(error),
            })
            .map_err(|error| error.to_string())?;

        let Some(text) = text else {
            return Ok(None);
        };
        let mut statement = connection
            .prepare(
                "SELECT position, name, mime_type, size
                 FROM message_attachments
                 WHERE account_id = ?1 AND mailbox_path = ?2 AND uid = ?3
                 ORDER BY position ASC",
            )
            .map_err(|error| error.to_string())?;
        let attachments = statement
            .query_map(params![account_id, mailbox_path, uid], |row| {
                Ok(crate::mail::AttachmentMetadata {
                    position: row.get::<_, i64>(0)? as usize,
                    name: row.get(1)?,
                    mime_type: row.get(2)?,
                    size: row.get(3)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        let html = connection
            .query_row(
                "SELECT html FROM message_html
                 WHERE account_id = ?1 AND mailbox_path = ?2 AND uid = ?3",
                params![account_id, mailbox_path, uid],
                |row| row.get(0),
            )
            .map(Some)
            .or_else(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                error => Err(error),
            })
            .map_err(|error| error.to_string())?;

        Ok(Some(MessageBody {
            text,
            html,
            attachments,
        }))
    }

    pub fn store_message_body(
        &self,
        account_id: i64,
        mailbox_path: &str,
        uid: u32,
        body: &MessageBody,
    ) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO message_bodies (account_id, mailbox_path, uid, body, cached_at)
                 VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)
                 ON CONFLICT(account_id, mailbox_path, uid) DO UPDATE SET
                   body = excluded.body,
                   cached_at = CURRENT_TIMESTAMP",
                params![account_id, mailbox_path, uid, body.text],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM message_html
                 WHERE account_id = ?1 AND mailbox_path = ?2 AND uid = ?3",
                params![account_id, mailbox_path, uid],
            )
            .map_err(|error| error.to_string())?;
        if let Some(html) = &body.html {
            transaction
                .execute(
                    "INSERT INTO message_html (account_id, mailbox_path, uid, html, cached_at)
                     VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)",
                    params![account_id, mailbox_path, uid, html],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction
            .execute(
                "DELETE FROM message_attachments
                 WHERE account_id = ?1 AND mailbox_path = ?2 AND uid = ?3",
                params![account_id, mailbox_path, uid],
            )
            .map_err(|error| error.to_string())?;
        for attachment in &body.attachments {
            transaction
                .execute(
                    "INSERT INTO message_attachments (account_id, mailbox_path, uid, position, name, mime_type, size)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        account_id,
                        mailbox_path,
                        uid,
                        attachment.position as i64,
                        attachment.name,
                        attachment.mime_type,
                        attachment.size
                    ],
                )
                .map_err(|error| error.to_string())?;
        }

        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn create_account(&self, input: CreateAccountInput) -> Result<Account, String> {
        let input = validate_input(input)?;
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO accounts (email, display_name, imap_host, smtp_host)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    input.email,
                    input.display_name,
                    input.imap_host,
                    input.smtp_host
                ],
            )
            .map_err(|error| error.to_string())?;

        Ok(Account {
            id: connection.last_insert_rowid(),
            email: input.email,
            display_name: input.display_name,
            imap_host: input.imap_host,
            smtp_host: input.smtp_host,
            auth_type: "password".to_string(),
            notifications_enabled: false,
        })
    }

    pub fn update_account(&self, input: UpdateAccountInput) -> Result<Account, String> {
        let id = input.id;
        let input = validate_input(CreateAccountInput {
            email: input.email,
            display_name: input.display_name,
            imap_host: input.imap_host,
            smtp_host: input.smtp_host,
        })?;
        let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
        let (current_email, current_imap_host, auth_type, notifications_enabled) = connection
            .query_row(
                "SELECT email, imap_host, auth_type, notifications_enabled FROM accounts WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, bool>(3)?,
                    ))
                },
            )
            .map_err(|_| "Account was not found.".to_string())?;
        if auth_type != "password" {
            return Err("The selected account does not use password authentication.".to_string());
        }

        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let affected = transaction
            .execute(
                "UPDATE accounts
                 SET email = ?1, display_name = ?2, imap_host = ?3, smtp_host = ?4
                 WHERE id = ?5",
                params![
                    input.email,
                    input.display_name,
                    input.imap_host,
                    input.smtp_host,
                    id
                ],
            )
            .map_err(|error| error.to_string())?;
        if affected == 0 {
            return Err("Account was not found.".to_string());
        }
        if current_email != input.email || current_imap_host != input.imap_host {
            transaction
                .execute("DELETE FROM mailboxes WHERE account_id = ?1", params![id])
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;

        Ok(Account {
            id,
            email: input.email,
            display_name: input.display_name,
            imap_host: input.imap_host,
            smtp_host: input.smtp_host,
            auth_type: "password".to_string(),
            notifications_enabled,
        })
    }

    pub fn create_gmail_account(&self, email: &str, display_name: &str) -> Result<Account, String> {
        let email = email.trim().to_lowercase();
        let display_name = display_name.trim();
        if email.is_empty() || display_name.is_empty() {
            return Err("Google account details are unavailable.".to_string());
        }

        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO accounts (email, display_name, imap_host, smtp_host, auth_type)
                 VALUES (?1, ?2, 'imap.gmail.com', 'smtp.gmail.com', 'gmail_oauth')",
                params![email, display_name],
            )
            .map_err(|error| error.to_string())?;

        Ok(Account {
            id: connection.last_insert_rowid(),
            email,
            display_name: display_name.to_string(),
            imap_host: "imap.gmail.com".to_string(),
            smtp_host: "smtp.gmail.com".to_string(),
            auth_type: "gmail_oauth".to_string(),
            notifications_enabled: false,
        })
    }

    pub fn delete_account(&self, account_id: i64) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let affected = connection
            .execute("DELETE FROM accounts WHERE id = ?1", params![account_id])
            .map_err(|error| error.to_string())?;

        if affected == 0 {
            return Err("Account was not found.".to_string());
        }

        Ok(())
    }

    pub fn store_inbox_snapshot(
        &self,
        account_id: i64,
        snapshot: &InboxSnapshot,
    ) -> Result<(), String> {
        let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;

        for mailbox in &snapshot.mailboxes {
            if let Some(uid_validity) = mailbox.uid_validity {
                let previous_uid_validity = transaction
                    .query_row(
                        "SELECT uid_validity FROM mailboxes WHERE account_id = ?1 AND path = ?2",
                        params![account_id, mailbox.path],
                        |row| row.get::<_, Option<i64>>(0),
                    )
                    .optional()
                    .map_err(|error| error.to_string())?
                    .flatten();
                if previous_uid_validity != Some(i64::from(uid_validity)) {
                    transaction
                        .execute(
                            "DELETE FROM messages WHERE account_id = ?1 AND mailbox_path = ?2",
                            params![account_id, mailbox.path],
                        )
                        .map_err(|error| error.to_string())?;
                }
            }
            transaction
                .execute(
                    "INSERT INTO mailboxes (account_id, path, uid_validity, synced_at)
                     VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
                     ON CONFLICT(account_id, path) DO UPDATE SET
                       uid_validity = COALESCE(excluded.uid_validity, mailboxes.uid_validity),
                       synced_at = CURRENT_TIMESTAMP",
                    params![account_id, mailbox.path, mailbox.uid_validity],
                )
                .map_err(|error| error.to_string())?;
        }

        for message in &snapshot.messages {
            transaction
                .execute(
                    "INSERT INTO messages (account_id, mailbox_path, uid, sender, sender_email, subject, date, internal_date, is_read, synced_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)
                     ON CONFLICT(account_id, mailbox_path, uid) DO UPDATE SET
                       sender = excluded.sender,
                       sender_email = excluded.sender_email,
                       subject = excluded.subject,
                       date = excluded.date,
                       internal_date = excluded.internal_date,
                       is_read = excluded.is_read,
                       synced_at = CURRENT_TIMESTAMP",
                    params![
                        account_id,
                        message.mailbox_path,
                        message.uid,
                        message.sender,
                        message.sender_email,
                        message.subject,
                        message.date,
                        message.internal_date,
                        message.is_read
                    ],
                )
                .map_err(|error| error.to_string())?;
        }

        transaction.commit().map_err(|error| error.to_string())
    }


    pub fn mark_message_read(
        &self,
        account_id: i64,
        mailbox_path: &str,
        uid: u32,
    ) -> Result<(), String> {
        self.connection
            .lock()
            .map_err(|error| error.to_string())?
            .execute(
                "UPDATE messages SET is_read = 1 WHERE account_id = ?1 AND mailbox_path = ?2 AND uid = ?3",
                rusqlite::params![account_id, mailbox_path, uid],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn mark_messages_read_bulk(
        &self,
        account_id: i64,
        mailbox_path: &str,
        uids: &[u32],
    ) -> Result<(), String> {
        if uids.is_empty() {
            return Ok(());
        }
        let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        
        let placeholders = uids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "UPDATE messages SET is_read = 1 WHERE account_id = ? AND mailbox_path = ? AND uid IN ({})",
            placeholders
        );
        
        let mut params: Vec<&dyn rusqlite::ToSql> = vec![&account_id, &mailbox_path];
        for uid in uids {
            params.push(uid);
        }
        
        transaction.execute(&query, rusqlite::params_from_iter(params)).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn delete_cached_messages(
        &self,
        account_id: i64,
        mailbox_path: &str,
        uids: &[u32],
    ) -> Result<(), String> {
        if uids.is_empty() {
            return Ok(());
        }
        let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;

        let placeholders = uids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "DELETE FROM messages WHERE account_id = ? AND mailbox_path = ? AND uid IN ({})",
            placeholders
        );

        let mut params: Vec<&dyn rusqlite::ToSql> = vec![&account_id, &mailbox_path];
        for uid in uids {
            params.push(uid);
        }

        transaction.execute(&query, rusqlite::params_from_iter(params)).map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn rename_account(&self, account_id: i64, display_name: &str) -> Result<Account, String> {
        let display_name = display_name.trim();
        if display_name.is_empty() {
            return Err("Enter an account name.".to_string());
        }

        let affected = {
            let connection = self.connection.lock().map_err(|error| error.to_string())?;
            connection
                .execute(
                    "UPDATE accounts SET display_name = ?1 WHERE id = ?2",
                    params![display_name, account_id],
                )
                .map_err(|error| error.to_string())?
        };
        if affected == 0 {
            return Err("Account was not found.".to_string());
        }

        self.get_account(account_id)
    }

    pub fn set_account_notifications(
        &self,
        account_id: i64,
        enabled: bool,
    ) -> Result<Account, String> {
        let affected = {
            let connection = self.connection.lock().map_err(|error| error.to_string())?;
            connection
                .execute(
                    "UPDATE accounts SET notifications_enabled = ?1 WHERE id = ?2",
                    params![enabled, account_id],
                )
                .map_err(|error| error.to_string())?
        };
        if affected == 0 {
            return Err("Account was not found.".to_string());
        }

        self.get_account(account_id)
    }

    /// Deletes every cached mailbox/message/body/attachment for every account
    /// (accounts and drafts are untouched) and reclaims the freed disk space.
    /// `messages` cascades to `message_bodies`, `message_attachments`, and
    /// `message_html` via `ON DELETE CASCADE`. Returns the (mailbox, message)
    /// row counts that were cleared, for diagnostics logging by the caller.
    pub fn flush_message_cache(&self) -> Result<(usize, usize), String> {
        let mut connection = self.connection.lock().map_err(|error| error.to_string())?;
        let transaction = connection.transaction().map_err(|error| error.to_string())?;
        let mailbox_count: i64 = transaction
            .query_row("SELECT COUNT(*) FROM mailboxes", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        let message_count: i64 = transaction
            .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM messages", [])
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM mailboxes", [])
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;

        connection
            .execute_batch("VACUUM;")
            .map_err(|error| error.to_string())?;

        Ok((mailbox_count as usize, message_count as usize))
    }

    pub fn list_notification_exclusions(&self) -> Result<Vec<NotificationExclusion>, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare("SELECT id, sender FROM notification_exclusions ORDER BY sender ASC")
            .map_err(|error| error.to_string())?;
        let exclusions = statement
            .query_map([], |row| {
                Ok(NotificationExclusion {
                    id: row.get(0)?,
                    sender: row.get(1)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        Ok(exclusions)
    }

    pub fn add_notification_exclusion(
        &self,
        sender: &str,
    ) -> Result<NotificationExclusion, String> {
        let sender = sender.trim().to_lowercase();
        if !sender.contains('@') {
            return Err("Enter a valid sender email address.".to_string());
        }

        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        connection
            .execute(
                "INSERT INTO notification_exclusions (sender) VALUES (?1)",
                params![sender],
            )
            .map_err(|error| match error {
                rusqlite::Error::SqliteFailure(sqlite_error, _)
                    if sqlite_error.code == rusqlite::ErrorCode::ConstraintViolation =>
                {
                    "That sender is already excluded.".to_string()
                }
                error => error.to_string(),
            })?;

        Ok(NotificationExclusion {
            id: connection.last_insert_rowid(),
            sender,
        })
    }

    pub fn remove_notification_exclusion(&self, id: i64) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let affected = connection
            .execute(
                "DELETE FROM notification_exclusions WHERE id = ?1",
                params![id],
            )
            .map_err(|error| error.to_string())?;

        if affected == 0 {
            return Err("Exclusion was not found.".to_string());
        }

        Ok(())
    }

    fn initialize(&self) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA journal_mode = WAL;
                 CREATE TABLE IF NOT EXISTS accounts (
                     id INTEGER PRIMARY KEY,
                     email TEXT NOT NULL UNIQUE,
                     display_name TEXT NOT NULL,
                     imap_host TEXT NOT NULL,
                     smtp_host TEXT NOT NULL,
                     auth_type TEXT NOT NULL DEFAULT 'password',
                     notifications_enabled INTEGER NOT NULL DEFAULT 0,
                     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE IF NOT EXISTS mailboxes (
                     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                     path TEXT NOT NULL,
                     uid_validity INTEGER,
                     synced_at TEXT NOT NULL,
                     PRIMARY KEY (account_id, path)
                 );
                 CREATE TABLE IF NOT EXISTS messages (
                     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                     mailbox_path TEXT NOT NULL,
                     uid INTEGER NOT NULL,
                     sender TEXT NOT NULL,
                     subject TEXT NOT NULL,
                     date TEXT NOT NULL,
                     internal_date INTEGER NOT NULL DEFAULT 0,
                     is_read INTEGER NOT NULL,
                     synced_at TEXT NOT NULL,
                     PRIMARY KEY (account_id, mailbox_path, uid)
                 );
                 CREATE TABLE IF NOT EXISTS message_bodies (
                     account_id INTEGER NOT NULL,
                     mailbox_path TEXT NOT NULL,
                     uid INTEGER NOT NULL,
                     body TEXT NOT NULL,
                     cached_at TEXT NOT NULL,
                     PRIMARY KEY (account_id, mailbox_path, uid),
                     FOREIGN KEY (account_id, mailbox_path, uid)
                       REFERENCES messages(account_id, mailbox_path, uid) ON DELETE CASCADE
                 );
                 CREATE TABLE IF NOT EXISTS message_attachments (
                     account_id INTEGER NOT NULL,
                     mailbox_path TEXT NOT NULL,
                     uid INTEGER NOT NULL,
                     position INTEGER NOT NULL,
                     name TEXT NOT NULL,
                     mime_type TEXT NOT NULL,
                     size INTEGER NOT NULL,
                     PRIMARY KEY (account_id, mailbox_path, uid, position),
                     FOREIGN KEY (account_id, mailbox_path, uid)
                       REFERENCES messages(account_id, mailbox_path, uid) ON DELETE CASCADE
                 );
                 CREATE TABLE IF NOT EXISTS message_html (
                     account_id INTEGER NOT NULL,
                     mailbox_path TEXT NOT NULL,
                     uid INTEGER NOT NULL,
                     html TEXT NOT NULL,
                     cached_at TEXT NOT NULL,
                     PRIMARY KEY (account_id, mailbox_path, uid),
                     FOREIGN KEY (account_id, mailbox_path, uid)
                       REFERENCES messages(account_id, mailbox_path, uid) ON DELETE CASCADE
                 );
                 CREATE TABLE IF NOT EXISTS drafts (
                     id INTEGER PRIMARY KEY,
                     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                     recipients TEXT NOT NULL,
                     subject TEXT NOT NULL,
                     body TEXT NOT NULL,
                     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE IF NOT EXISTS notification_exclusions (
                     id INTEGER PRIMARY KEY,
                     sender TEXT NOT NULL UNIQUE COLLATE NOCASE,
                     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );",
            )
            .map_err(|error| error.to_string())?;
        add_column_if_missing(&connection, "mailboxes", "uid_validity", "INTEGER")?;
        add_column_if_missing(
            &connection,
            "accounts",
            "auth_type",
            "TEXT NOT NULL DEFAULT 'password'",
        )?;
        add_column_if_missing(
            &connection,
            "messages",
            "internal_date",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            &connection,
            "accounts",
            "notifications_enabled",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        add_column_if_missing(
            &connection,
            "messages",
            "sender_email",
            "TEXT NOT NULL DEFAULT ''",
        )
    }

    #[cfg(test)]
    fn in_memory() -> Result<Self, String> {
        let database = Self {
            connection: Mutex::new(
                Connection::open_in_memory().map_err(|error| error.to_string())?,
            ),
        };
        database.initialize()?;
        Ok(database)
    }
}

fn add_column_if_missing(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let exists = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?
        .iter()
        .any(|name| name == column);
    if !exists {
        connection
            .execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN {column} {definition}"
            ))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn validate_input(input: CreateAccountInput) -> Result<CreateAccountInput, String> {
    let input = CreateAccountInput {
        email: input.email.trim().to_lowercase(),
        display_name: input.display_name.trim().to_string(),
        imap_host: input.imap_host.trim().to_lowercase(),
        smtp_host: input.smtp_host.trim().to_lowercase(),
    };

    if !input.email.contains('@') {
        return Err("Enter a valid email address.".to_string());
    }

    if input.display_name.is_empty() || input.imap_host.is_empty() || input.smtp_host.is_empty() {
        return Err("Complete all account fields.".to_string());
    }

    Ok(input)
}

fn validate_draft(input: SaveDraftInput) -> Result<SaveDraftInput, String> {
    if input.recipients.len() > 10_000
        || input.subject.len() > 10_000
        || input.body.len() > 1_000_000
    {
        return Err("Draft is too large to save.".to_string());
    }

    Ok(SaveDraftInput {
        id: input.id,
        account_id: input.account_id,
        recipients: input.recipients.trim().to_string(),
        subject: input.subject.trim().to_string(),
        body: input.body,
    })
}

#[cfg(test)]
mod tests {
    use super::{CreateAccountInput, Database, SaveDraftInput, UpdateAccountInput};
    use crate::mail::{InboxSnapshot, MailboxSnapshot, MessageBody, MessageSnapshot};

    #[test]
    fn persists_account_metadata_without_credentials() {
        let database = Database::in_memory().expect("database should initialize");
        let account = database
            .create_account(CreateAccountInput {
                email: "  hello@example.com ".to_string(),
                display_name: " RMail ".to_string(),
                imap_host: " IMAP.EXAMPLE.COM ".to_string(),
                smtp_host: " SMTP.EXAMPLE.COM ".to_string(),
            })
            .expect("account should be created");
        assert_eq!(account.email, "hello@example.com");
        assert_eq!(account.imap_host, "imap.example.com");
        assert_eq!(
            database
                .list_accounts()
                .expect("accounts should list")
                .len(),
            1
        );
        database
            .delete_account(account.id)
            .expect("account should be deleted");
        assert!(database
            .list_accounts()
            .expect("accounts should list")
            .is_empty());
    }

    #[test]
    fn updates_password_account_connection_settings() {
        let database = Database::in_memory().expect("database should initialize");
        let account = database
            .create_account(CreateAccountInput {
                email: "old@example.com".to_string(),
                display_name: "Old".to_string(),
                imap_host: "imap.old.example.com".to_string(),
                smtp_host: "smtp.old.example.com".to_string(),
            })
            .expect("account should be created");
        database
            .store_inbox_snapshot(
                account.id,
                &InboxSnapshot {
                    mailboxes: vec![MailboxSnapshot {
                        path: "INBOX".to_string(),
                        uid_validity: Some(1),
                    }],
                    messages: vec![MessageSnapshot {
                        mailbox_path: "INBOX".to_string(),
                        uid: 1,
                        sender: "Sender".to_string(),
                        sender_email: "sender@example.com".to_string(),
                        subject: "Old message".to_string(),
                        date: "Today".to_string(),
                        internal_date: 1,
                        is_read: false,
                    }],
                },
            )
            .expect("snapshot should persist");

        let updated = database
            .update_account(UpdateAccountInput {
                id: account.id,
                email: " NEW@EXAMPLE.COM ".to_string(),
                display_name: " New ".to_string(),
                imap_host: " IMAP.NEW.EXAMPLE.COM ".to_string(),
                smtp_host: " SMTP.NEW.EXAMPLE.COM ".to_string(),
            })
            .expect("account should be updated");

        assert_eq!(updated.email, "new@example.com");
        assert_eq!(updated.display_name, "New");
        assert_eq!(updated.imap_host, "imap.new.example.com");
        assert_eq!(
            database
                .get_account(account.id)
                .expect("account should load")
                .smtp_host,
            "smtp.new.example.com"
        );
        assert!(database
            .list_cached_mailboxes(account.id)
            .expect("mailboxes should list")
            .is_empty());
    }

    #[test]
    fn creates_gmail_account_with_oauth_authentication() {
        let database = Database::in_memory().expect("database should initialize");
        let account = database
            .create_gmail_account(" Gmail.User@gmail.com ", " Gmail User ")
            .expect("Gmail account should be created");

        assert_eq!(account.email, "gmail.user@gmail.com");
        assert_eq!(account.auth_type, "gmail_oauth");
        assert_eq!(account.imap_host, "imap.gmail.com");
        assert_eq!(account.smtp_host, "smtp.gmail.com");
    }

    #[test]
    fn stores_synced_mailbox_metadata() {
        let database = Database::in_memory().expect("database should initialize");
        let account = database
            .create_account(CreateAccountInput {
                email: "hello@example.com".to_string(),
                display_name: "RMail".to_string(),
                imap_host: "imap.example.com".to_string(),
                smtp_host: "smtp.example.com".to_string(),
            })
            .expect("account should be created");

        database
            .store_inbox_snapshot(
                account.id,
                &InboxSnapshot {
                    mailboxes: vec![
                        MailboxSnapshot {
                            path: "INBOX".to_string(),
                            uid_validity: Some(1),
                        },
                        MailboxSnapshot {
                            path: "Sent".to_string(),
                            uid_validity: Some(1),
                        },
                    ],
                    messages: vec![MessageSnapshot {
                        mailbox_path: "Sent".to_string(),
                        uid: 7,
                        sender: "Sender".to_string(),
                        sender_email: "sender@example.com".to_string(),
                        subject: "Subject".to_string(),
                        date: "Today".to_string(),
                        internal_date: 1_700_000_000,
                        is_read: false,
                    }],
                },
            )
            .expect("snapshot should persist");
        database
            .store_message_body(
                account.id,
                "Sent",
                7,
                &MessageBody {
                    text: "Cached body".to_string(),
                    html: Some("<p>Cached HTML</p>".to_string()),
                    attachments: Vec::new(),
                },
            )
            .expect("body should persist");
        assert_eq!(
            database
                .get_cached_message_body(account.id, "Sent", 7)
                .expect("body should load"),
            Some(MessageBody {
                text: "Cached body".to_string(),
                html: Some("<p>Cached HTML</p>".to_string()),
                attachments: Vec::new(),
            })
        );

        let count: i64 = {
            let connection = database.connection.lock().expect("connection should lock");
            connection
                .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
                .expect("messages should count")
        };
        assert_eq!(count, 1);
        assert_eq!(
            database
                .list_cached_mailboxes(account.id)
                .expect("mailboxes should list")[0]
                .unread_count,
            0
        );
        assert_eq!(
            database
                .list_cached_messages(account.id, "Sent")
                .expect("sent messages should list")
                .len(),
            1
        );
    }

    #[test]
    fn saves_and_updates_local_drafts() {
        let database = Database::in_memory().expect("database should initialize");
        let account = database
            .create_account(CreateAccountInput {
                email: "hello@example.com".to_string(),
                display_name: "RMail".to_string(),
                imap_host: "imap.example.com".to_string(),
                smtp_host: "smtp.example.com".to_string(),
            })
            .expect("account should be created");
        let draft = database
            .save_draft(SaveDraftInput {
                id: None,
                account_id: account.id,
                recipients: " person@example.com ".to_string(),
                subject: " Subject ".to_string(),
                body: "Draft body".to_string(),
            })
            .expect("draft should save");
        let updated = database
            .save_draft(SaveDraftInput {
                id: Some(draft.id),
                account_id: account.id,
                recipients: draft.recipients,
                subject: "Updated".to_string(),
                body: draft.body,
            })
            .expect("draft should update");

        assert_eq!(updated.subject, "Updated");
        database
            .delete_draft(updated.id)
            .expect("draft should delete");
    }

    #[test]
    fn lists_inbox_messages_from_every_account() {
        let database = Database::in_memory().expect("database should initialize");
        let first = database
            .create_account(CreateAccountInput {
                email: "first@example.com".to_string(),
                display_name: "First".to_string(),
                imap_host: "imap.first.example.com".to_string(),
                smtp_host: "smtp.first.example.com".to_string(),
            })
            .expect("first account should be created");
        let second = database
            .create_account(CreateAccountInput {
                email: "second@example.com".to_string(),
                display_name: "Second".to_string(),
                imap_host: "imap.second.example.com".to_string(),
                smtp_host: "smtp.second.example.com".to_string(),
            })
            .expect("second account should be created");

        for (account, uid, internal_date) in [(&first, 1, 10), (&second, 1, 20)] {
            database
                .store_inbox_snapshot(
                    account.id,
                    &InboxSnapshot {
                        mailboxes: vec![MailboxSnapshot {
                            path: "INBOX".to_string(),
                            uid_validity: Some(1),
                        }],
                        messages: vec![MessageSnapshot {
                            mailbox_path: "INBOX".to_string(),
                            uid,
                            sender: "Sender".to_string(),
                            sender_email: "sender@example.com".to_string(),
                            subject: "Subject".to_string(),
                            date: "Today".to_string(),
                            internal_date,
                            is_read: false,
                        }],
                    },
                )
                .expect("snapshot should persist");
        }

        let messages = database
            .list_unified_inbox()
            .expect("unified inbox should list");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].account_display_name, "Second");
        assert_eq!(messages[1].account_display_name, "First");
    }

    #[test]
    fn clears_cached_body_when_uid_validity_changes() {
        let database = Database::in_memory().expect("database should initialize");
        let account = database
            .create_account(CreateAccountInput {
                email: "hello@example.com".to_string(),
                display_name: "RMail".to_string(),
                imap_host: "imap.example.com".to_string(),
                smtp_host: "smtp.example.com".to_string(),
            })
            .expect("account should be created");
        let snapshot = |uid_validity| InboxSnapshot {
            mailboxes: vec![MailboxSnapshot {
                path: "INBOX".to_string(),
                uid_validity: Some(uid_validity),
            }],
            messages: vec![MessageSnapshot {
                mailbox_path: "INBOX".to_string(),
                uid: 1,
                sender: "Sender".to_string(),
                sender_email: "sender@example.com".to_string(),
                subject: "Subject".to_string(),
                date: "Today".to_string(),
                internal_date: 1,
                is_read: false,
            }],
        };
        database
            .store_inbox_snapshot(account.id, &snapshot(1))
            .expect("snapshot should persist");
        database
            .store_message_body(
                account.id,
                "INBOX",
                1,
                &MessageBody {
                    text: "Cached body".to_string(),
                    html: None,
                    attachments: Vec::new(),
                },
            )
            .expect("body should persist");

        database
            .store_inbox_snapshot(account.id, &snapshot(2))
            .expect("updated snapshot should persist");

        assert_eq!(
            database
                .get_cached_message_body(account.id, "INBOX", 1)
                .expect("body should load"),
            None
        );
    }

    #[test]
    fn deletes_cached_messages_and_related_data() {
        let database = Database::in_memory().expect("database should initialize");
        let account = database
            .create_account(CreateAccountInput {
                email: "hello@example.com".to_string(),
                display_name: "RMail".to_string(),
                imap_host: "imap.example.com".to_string(),
                smtp_host: "smtp.example.com".to_string(),
            })
            .expect("account should be created");
        database
            .store_inbox_snapshot(
                account.id,
                &InboxSnapshot {
                    mailboxes: vec![MailboxSnapshot {
                        path: "INBOX".to_string(),
                        uid_validity: Some(1),
                    }],
                    messages: vec![
                        MessageSnapshot {
                            mailbox_path: "INBOX".to_string(),
                            uid: 1,
                            sender: "Sender".to_string(),
                            sender_email: "sender@example.com".to_string(),
                            subject: "Keep".to_string(),
                            date: "Today".to_string(),
                            internal_date: 1,
                            is_read: false,
                        },
                        MessageSnapshot {
                            mailbox_path: "INBOX".to_string(),
                            uid: 2,
                            sender: "Sender".to_string(),
                            sender_email: "sender@example.com".to_string(),
                            subject: "Delete".to_string(),
                            date: "Today".to_string(),
                            internal_date: 2,
                            is_read: false,
                        },
                    ],
                },
            )
            .expect("snapshot should persist");
        database
            .store_message_body(
                account.id,
                "INBOX",
                2,
                &MessageBody {
                    text: "Cached body".to_string(),
                    html: None,
                    attachments: Vec::new(),
                },
            )
            .expect("body should persist");

        database
            .delete_cached_messages(account.id, "INBOX", &[2])
            .expect("message should delete");

        let remaining = database
            .list_cached_messages(account.id, "INBOX")
            .expect("messages should list");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].uid, 1);
        assert_eq!(
            database
                .get_cached_message_body(account.id, "INBOX", 2)
                .expect("body should load"),
            None
        );
    }

    #[test]
    fn renames_any_account_regardless_of_auth_type() {
        let database = Database::in_memory().expect("database should initialize");
        let gmail_account = database
            .create_gmail_account("person@gmail.com", "person@gmail.com (Person)")
            .expect("Gmail account should be created");

        let renamed = database
            .rename_account(gmail_account.id, "  Work Gmail  ")
            .expect("Gmail account should rename");

        assert_eq!(renamed.display_name, "Work Gmail");
        assert_eq!(
            database
                .get_account(gmail_account.id)
                .expect("account should load")
                .display_name,
            "Work Gmail"
        );
        assert!(database.rename_account(gmail_account.id, "   ").is_err());
    }

    #[test]
    fn notifications_are_disabled_by_default_and_toggle_per_account() {
        let database = Database::in_memory().expect("database should initialize");
        let account = database
            .create_account(CreateAccountInput {
                email: "hello@example.com".to_string(),
                display_name: "RMail".to_string(),
                imap_host: "imap.example.com".to_string(),
                smtp_host: "smtp.example.com".to_string(),
            })
            .expect("account should be created");
        assert!(!account.notifications_enabled);

        let enabled = database
            .set_account_notifications(account.id, true)
            .expect("notifications should enable");
        assert!(enabled.notifications_enabled);
        assert!(
            database
                .get_account(account.id)
                .expect("account should load")
                .notifications_enabled
        );

        let disabled = database
            .set_account_notifications(account.id, false)
            .expect("notifications should disable");
        assert!(!disabled.notifications_enabled);
    }

    #[test]
    fn flushes_message_cache_but_keeps_accounts_and_drafts() {
        let database = Database::in_memory().expect("database should initialize");
        let account = database
            .create_account(CreateAccountInput {
                email: "hello@example.com".to_string(),
                display_name: "RMail".to_string(),
                imap_host: "imap.example.com".to_string(),
                smtp_host: "smtp.example.com".to_string(),
            })
            .expect("account should be created");
        database
            .store_inbox_snapshot(
                account.id,
                &InboxSnapshot {
                    mailboxes: vec![MailboxSnapshot {
                        path: "INBOX".to_string(),
                        uid_validity: Some(1),
                    }],
                    messages: vec![MessageSnapshot {
                        mailbox_path: "INBOX".to_string(),
                        uid: 1,
                        sender: "Sender".to_string(),
                        sender_email: "sender@example.com".to_string(),
                        subject: "Subject".to_string(),
                        date: "Today".to_string(),
                        internal_date: 1,
                        is_read: false,
                    }],
                },
            )
            .expect("snapshot should persist");
        database
            .store_message_body(
                account.id,
                "INBOX",
                1,
                &MessageBody {
                    text: "Cached body".to_string(),
                    html: Some("<p>Cached HTML</p>".to_string()),
                    attachments: Vec::new(),
                },
            )
            .expect("body should persist");
        database
            .save_draft(SaveDraftInput {
                id: None,
                account_id: account.id,
                recipients: "person@example.com".to_string(),
                subject: "Draft".to_string(),
                body: "Draft body".to_string(),
            })
            .expect("draft should save");

        let (flushed_mailboxes, flushed_messages) = database
            .flush_message_cache()
            .expect("cache should flush");
        assert_eq!(flushed_mailboxes, 1);
        assert_eq!(flushed_messages, 1);

        assert!(database
            .list_cached_mailboxes(account.id)
            .expect("mailboxes should list")
            .is_empty());
        assert!(database
            .list_cached_messages(account.id, "INBOX")
            .expect("messages should list")
            .is_empty());
        assert_eq!(
            database
                .get_cached_message_body(account.id, "INBOX", 1)
                .expect("body should load"),
            None
        );
        assert_eq!(
            database
                .list_accounts()
                .expect("accounts should list")
                .len(),
            1
        );
        let connection = database.connection.lock().expect("connection should lock");
        let draft_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM drafts", [], |row| row.get(0))
            .expect("drafts should count");
        assert_eq!(draft_count, 1);
    }

    #[test]
    fn manages_notification_exclusions_case_insensitively() {
        let database = Database::in_memory().expect("database should initialize");
        assert!(database
            .list_notification_exclusions()
            .expect("exclusions should list")
            .is_empty());

        let exclusion = database
            .add_notification_exclusion("  Newsletter@Example.com  ")
            .expect("exclusion should be added");
        assert_eq!(exclusion.sender, "newsletter@example.com");

        assert!(database
            .add_notification_exclusion("newsletter@EXAMPLE.com")
            .is_err());
        assert!(database.add_notification_exclusion("not-an-email").is_err());

        assert_eq!(
            database
                .list_notification_exclusions()
                .expect("exclusions should list")
                .len(),
            1
        );

        database
            .remove_notification_exclusion(exclusion.id)
            .expect("exclusion should be removed");
        assert!(database
            .list_notification_exclusions()
            .expect("exclusions should list")
            .is_empty());
        assert!(database.remove_notification_exclusion(exclusion.id).is_err());
    }
}
