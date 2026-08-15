use std::{fs, path::Path, sync::Mutex};

use rusqlite::{params, Connection};
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    pub email: String,
    pub display_name: String,
    pub imap_host: String,
    pub smtp_host: String,
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
    pub uid: u32,
    pub sender: String,
    pub subject: String,
    pub date: String,
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

pub struct Database {
    connection: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let database = Self {
            connection: Mutex::new(Connection::open(path).map_err(|error| error.to_string())?),
        };
        database.initialize()?;

        Ok(database)
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>, String> {
        let connection = self.connection.lock().map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT id, email, display_name, imap_host, smtp_host
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
                "SELECT id, email, display_name, imap_host, smtp_host FROM accounts WHERE id = ?1",
                params![account_id],
                |row| {
                    Ok(Account {
                        id: row.get(0)?,
                        email: row.get(1)?,
                        display_name: row.get(2)?,
                        imap_host: row.get(3)?,
                        smtp_host: row.get(4)?,
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
                "SELECT uid, sender, subject, date, is_read
                 FROM messages
                 WHERE account_id = ?1 AND mailbox_path = ?2
                 ORDER BY uid DESC",
            )
            .map_err(|error| error.to_string())?;
        let messages = statement
            .query_map(params![account_id, mailbox_path], |row| {
                Ok(CachedMessage {
                    uid: row.get(0)?,
                    sender: row.get(1)?,
                    subject: row.get(2)?,
                    date: row.get(3)?,
                    is_read: row.get(4)?,
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
            transaction
                .execute(
                    "INSERT INTO mailboxes (account_id, path, synced_at)
                     VALUES (?1, ?2, CURRENT_TIMESTAMP)
                     ON CONFLICT(account_id, path) DO UPDATE SET synced_at = CURRENT_TIMESTAMP",
                    params![account_id, mailbox.path],
                )
                .map_err(|error| error.to_string())?;
        }

        for message in &snapshot.messages {
            transaction
                .execute(
                    "INSERT INTO messages (account_id, mailbox_path, uid, sender, subject, date, is_read, synced_at)
                     VALUES (?1, 'INBOX', ?2, ?3, ?4, ?5, ?6, CURRENT_TIMESTAMP)
                     ON CONFLICT(account_id, mailbox_path, uid) DO UPDATE SET
                       sender = excluded.sender,
                       subject = excluded.subject,
                       date = excluded.date,
                       is_read = excluded.is_read,
                       synced_at = CURRENT_TIMESTAMP",
                    params![
                        account_id,
                        message.uid,
                        message.sender,
                        message.subject,
                        message.date,
                        message.is_read
                    ],
                )
                .map_err(|error| error.to_string())?;
        }

        transaction.commit().map_err(|error| error.to_string())
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
                     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                 );
                 CREATE TABLE IF NOT EXISTS mailboxes (
                     account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                     path TEXT NOT NULL,
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
                 );",
            )
            .map_err(|error| error.to_string())
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
    use super::{CreateAccountInput, Database, SaveDraftInput};
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
                    mailboxes: vec![MailboxSnapshot {
                        path: "INBOX".to_string(),
                    }],
                    messages: vec![MessageSnapshot {
                        uid: 7,
                        sender: "Sender".to_string(),
                        subject: "Subject".to_string(),
                        date: "Today".to_string(),
                        is_read: false,
                    }],
                },
            )
            .expect("snapshot should persist");
        database
            .store_message_body(
                account.id,
                "INBOX",
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
                .get_cached_message_body(account.id, "INBOX", 7)
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
}
