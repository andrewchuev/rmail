use std::{path::Path, time::Duration};

use ammonia::{Builder as HtmlSanitizer, UrlRelative};
use async_native_tls::TlsConnector;
use futures_util::TryStreamExt;
use lettre::{
    message::{header::ContentType, Mailbox, Message},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Tokio1Executor,
};
use mailparse::{parse_mail, DispositionType, ParsedMail};
use serde::{Deserialize, Serialize};
use tokio::{io::AsyncWriteExt, net::TcpStream, time::timeout};

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(15);
const MESSAGE_SYNC_LIMIT: u32 = 50;
const MESSAGE_BODY_CHARACTER_LIMIT: usize = 200_000;

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

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageBody {
    pub text: String,
    pub html: Option<String>,
    pub attachments: Vec<AttachmentMetadata>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMetadata {
    pub position: usize,
    pub name: String,
    pub mime_type: String,
    pub size: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingMessageInput {
    pub recipients: String,
    pub subject: String,
    pub body: String,
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

pub async fn fetch_message_text(
    input: MailConnectionInput,
    mailbox_path: &str,
    uid: u32,
) -> Result<MessageBody, String> {
    let source = fetch_message_source(input, mailbox_path, uid).await?;
    let body = parse_message(&source)?;
    Ok(body)
}

pub async fn save_attachment(
    input: MailConnectionInput,
    mailbox_path: &str,
    uid: u32,
    attachment_position: usize,
    destination: &Path,
) -> Result<u64, String> {
    if !destination.is_absolute() || destination.file_name().is_none() {
        return Err("Choose a valid file location.".to_string());
    }

    let source = fetch_message_source(input, mailbox_path, uid).await?;
    let parsed = parse_mail(&source).map_err(|_| "Unable to parse the message.".to_string())?;
    let content = attachment_content(&parsed, attachment_position)
        .ok_or_else(|| "Attachment is unavailable.".to_string())?;

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .await
        .map_err(|_| {
            "Unable to create the attachment file. Choose another name or location.".to_string()
        })?;
    file.write_all(&content)
        .await
        .map_err(|_| "Unable to save the attachment file.".to_string())?;
    file.flush()
        .await
        .map_err(|_| "Unable to save the attachment file.".to_string())?;

    u64::try_from(content.len()).map_err(|_| "Attachment is too large to save.".to_string())
}

pub async fn send_outgoing_message(
    input: MailConnectionInput,
    display_name: &str,
    message: OutgoingMessageInput,
) -> Result<(), String> {
    let input = validate_input(input)?;
    let message = build_outgoing_message(&input.username, display_name, message)?;
    let transport = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&input.smtp_host)
        .map_err(|_| "Invalid SMTP server address.".to_string())?
        .port(input.smtp_port)
        .credentials(Credentials::new(input.username, input.password))
        .build::<Tokio1Executor>();

    within_timeout(transport.send(message), "Unable to send the message.")
        .await
        .map(|_| ())
}

async fn fetch_message_source(
    input: MailConnectionInput,
    mailbox_path: &str,
    uid: u32,
) -> Result<Vec<u8>, String> {
    let input = validate_input(input)?;
    if mailbox_path.trim().is_empty() {
        return Err("Mailbox path is required.".to_string());
    }

    let mut session = connect_session(&input).await?;
    within_timeout(session.select(mailbox_path), "Unable to open the mailbox.").await?;
    let messages = within_timeout(
        session.uid_fetch(uid.to_string(), "(BODY.PEEK[])"),
        "Unable to fetch the message body.",
    )
    .await?
    .try_collect::<Vec<_>>()
    .await
    .map_err(|_| "Unable to fetch the message body.".to_string())?;
    let source = messages
        .into_iter()
        .find_map(|message| message.body().map(|body| body.to_vec()))
        .ok_or_else(|| "Message body is unavailable.".to_string())?;

    let _ = session.logout().await;
    Ok(source)
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

fn parse_message(source: &[u8]) -> Result<MessageBody, String> {
    let parsed = parse_mail(source).map_err(|_| "Unable to parse the message.".to_string())?;
    let text = parsed
        .parts()
        .filter(|part| part.ctype.mimetype.eq_ignore_ascii_case("text/plain"))
        .find_map(|part| part.get_body().ok())
        .map(limit_message_text)
        .unwrap_or_else(|| "A plain-text version of this message is unavailable.".to_string());
    let html = parsed
        .parts()
        .filter(|part| part.ctype.mimetype.eq_ignore_ascii_case("text/html"))
        .find_map(|part| part.get_body().ok())
        .map(sanitize_html);
    let attachments = parsed
        .parts()
        .filter_map(attachment_metadata)
        .enumerate()
        .map(|(position, mut attachment)| {
            attachment.position = position;
            attachment
        })
        .collect();

    Ok(MessageBody {
        text,
        html,
        attachments,
    })
}

fn attachment_metadata(part: &ParsedMail<'_>) -> Option<AttachmentMetadata> {
    let disposition = part.get_content_disposition();
    let name = disposition
        .params
        .get("filename")
        .or_else(|| part.ctype.params.get("name"));

    if name.is_none() && !matches!(disposition.disposition, DispositionType::Attachment) {
        return None;
    }

    Some(AttachmentMetadata {
        position: 0,
        name: name.cloned().unwrap_or_else(|| "Attachment".to_string()),
        mime_type: part.ctype.mimetype.clone(),
        size: i64::try_from(part.get_body_raw().ok()?.len()).ok()?,
    })
}

fn attachment_content(parsed: &ParsedMail<'_>, position: usize) -> Option<Vec<u8>> {
    parsed
        .parts()
        .filter(|part| attachment_metadata(part).is_some())
        .nth(position)
        .and_then(|part| part.get_body_raw().ok())
}

fn build_outgoing_message(
    sender_address: &str,
    display_name: &str,
    input: OutgoingMessageInput,
) -> Result<Message, String> {
    let recipients = input
        .recipients
        .split([',', ';'])
        .map(str::trim)
        .filter(|recipient| !recipient.is_empty())
        .map(|recipient| recipient.parse::<Mailbox>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "Enter valid recipient email addresses.".to_string())?;
    if recipients.is_empty() {
        return Err("Enter at least one recipient.".to_string());
    }
    if input.body.trim().is_empty() {
        return Err("Message text cannot be empty.".to_string());
    }

    let sender = sender_address
        .parse::<Mailbox>()
        .map_err(|_| "Sender email address is invalid.".to_string())?;
    let sender = Mailbox::new(
        (!display_name.trim().is_empty()).then(|| display_name.trim().to_string()),
        sender.email,
    );
    let mut builder = Message::builder()
        .from(sender)
        .subject(input.subject.trim())
        .header(ContentType::TEXT_PLAIN);
    for recipient in recipients {
        builder = builder.to(recipient);
    }
    builder
        .body(input.body)
        .map_err(|_| "Unable to prepare the message.".to_string())
}

fn limit_message_text(value: String) -> String {
    value.chars().take(MESSAGE_BODY_CHARACTER_LIMIT).collect()
}

fn sanitize_html(value: String) -> String {
    let mut sanitizer = HtmlSanitizer::default();
    sanitizer
        .rm_tags(&[
            "audio", "base", "button", "embed", "form", "iframe", "img", "input", "link", "object",
            "picture", "source", "video",
        ])
        .url_relative(UrlRelative::Deny);
    sanitizer.clean(&value).to_string()
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
    use super::{
        attachment_content, build_outgoing_message, parse_message, validate_input,
        MailConnectionInput, OutgoingMessageInput,
    };
    use mailparse::parse_mail;

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

    #[test]
    fn sanitizes_html_and_preserves_plain_text() {
        let message = parse_message(
            b"Content-Type: multipart/alternative; boundary=part\r\n\r\n--part\r\nContent-Type: text/plain\r\n\r\nPlain body\r\n--part\r\nContent-Type: text/html\r\n\r\n<script>alert(1)</script><img src=\"https://tracker.test/pixel\"><p>HTML body</p>\r\n--part--\r\n",
        )
        .expect("message should parse");

        assert_eq!(message.text, "Plain body");
        assert!(message
            .html
            .as_deref()
            .is_some_and(|html| html.contains("HTML body")));
        assert!(message
            .html
            .as_deref()
            .is_some_and(|html| !html.contains("script")));
        assert!(message
            .html
            .as_deref()
            .is_some_and(|html| !html.contains("img")));
    }

    #[test]
    fn finds_attachment_by_stable_position() {
        let source = b"Content-Type: multipart/mixed; boundary=part\r\n\r\n--part\r\nContent-Type: text/plain\r\n\r\nPlain body\r\n--part\r\nContent-Type: application/octet-stream; name=first.bin\r\nContent-Disposition: attachment; filename=first.bin\r\nContent-Transfer-Encoding: base64\r\n\r\nZmlyc3Q=\r\n--part\r\nContent-Type: application/octet-stream; name=second.bin\r\nContent-Disposition: attachment; filename=second.bin\r\nContent-Transfer-Encoding: base64\r\n\r\nc2Vjb25k\r\n--part--\r\n";
        let message = parse_message(source).expect("message should parse");
        let parsed = parse_mail(source).expect("message should parse");

        assert_eq!(message.attachments.len(), 2);
        assert_eq!(message.attachments[1].position, 1);
        assert_eq!(attachment_content(&parsed, 1), Some(b"second".to_vec()));
    }

    #[test]
    fn builds_plain_text_message_for_multiple_recipients() {
        let message = build_outgoing_message(
            "sender@example.com",
            "Sender",
            OutgoingMessageInput {
                recipients: "first@example.com; second@example.com".to_string(),
                subject: "Subject".to_string(),
                body: "Message body".to_string(),
            },
        )
        .expect("message should build");

        assert_eq!(message.envelope().to().len(), 2);
        assert!(String::from_utf8_lossy(&message.formatted()).contains("Message body"));
    }
}
