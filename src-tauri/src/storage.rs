use std::{fs, path::Path, sync::Mutex};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::mail::InboxSnapshot;

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

#[cfg(test)]
mod tests {
    use super::{CreateAccountInput, Database};
    use crate::mail::{InboxSnapshot, MailboxSnapshot, MessageSnapshot};

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
}
