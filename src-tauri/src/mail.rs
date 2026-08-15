use std::time::Duration;

use async_native_tls::TlsConnector;
use futures_util::TryStreamExt;
use lettre::{transport::smtp::authentication::Credentials, AsyncSmtpTransport, Tokio1Executor};
use serde::{Deserialize, Serialize};
use tokio::{net::TcpStream, time::timeout};

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(15);

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

pub async fn test_connection(input: MailConnectionInput) -> Result<MailConnectionStatus, String> {
    let input = validate_input(input)?;
    let mailboxes = test_imap(&input).await?;
    let smtp_ready = test_smtp(&input).await?;

    Ok(MailConnectionStatus {
        mailboxes,
        smtp_ready,
    })
}

async fn test_imap(input: &MailConnectionInput) -> Result<Vec<String>, String> {
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

    let mut session = client
        .login(&input.username, &input.password)
        .await
        .map_err(|_| "Unable to authenticate with IMAP.".to_string())?;
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
