use std::{fs, path::Path, sync::Mutex};

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

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
}
