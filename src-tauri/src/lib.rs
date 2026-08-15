mod mail;
mod storage;

use mail::{
    fetch_message_text, save_attachment, sync_inbox, test_connection, MailConnectionInput,
    MailConnectionStatus, MessageBody,
};
use serde::{Deserialize, Serialize};
use storage::{Account, CachedMailbox, CachedMessage, CreateAccountInput, Database};
use tauri::Manager;

struct AppState {
    database: Database,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncAccountInput {
    account_id: i64,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncAccountStatus {
    mailbox_count: usize,
    message_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CachedMessagesInput {
    account_id: i64,
    mailbox_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadMessageBodyInput {
    account_id: i64,
    mailbox_path: String,
    uid: u32,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAttachmentInput {
    account_id: i64,
    mailbox_path: String,
    uid: u32,
    attachment_position: usize,
    password: String,
    destination: std::path::PathBuf,
}

#[tauri::command]
fn list_accounts(state: tauri::State<'_, AppState>) -> Result<Vec<Account>, String> {
    state.database.list_accounts()
}

#[tauri::command]
fn create_account(
    input: CreateAccountInput,
    state: tauri::State<'_, AppState>,
) -> Result<Account, String> {
    state.database.create_account(input)
}

#[tauri::command]
fn delete_account(account_id: i64, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.database.delete_account(account_id)
}

#[tauri::command]
fn list_cached_mailboxes(
    account_id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<CachedMailbox>, String> {
    state.database.list_cached_mailboxes(account_id)
}

#[tauri::command]
fn list_cached_messages(
    input: CachedMessagesInput,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<CachedMessage>, String> {
    state
        .database
        .list_cached_messages(input.account_id, &input.mailbox_path)
}

#[tauri::command]
async fn load_message_body(
    input: LoadMessageBodyInput,
    state: tauri::State<'_, AppState>,
) -> Result<MessageBody, String> {
    if let Some(body) =
        state
            .database
            .get_cached_message_body(input.account_id, &input.mailbox_path, input.uid)?
    {
        return Ok(body);
    }

    let account = state.database.get_account(input.account_id)?;
    let body = fetch_message_text(
        MailConnectionInput {
            imap_host: account.imap_host,
            imap_port: 993,
            smtp_host: account.smtp_host,
            smtp_port: 587,
            username: account.email,
            password: input.password,
        },
        &input.mailbox_path,
        input.uid,
    )
    .await?;
    state
        .database
        .store_message_body(input.account_id, &input.mailbox_path, input.uid, &body)?;

    Ok(body)
}

#[tauri::command]
async fn save_message_attachment(
    input: SaveAttachmentInput,
    state: tauri::State<'_, AppState>,
) -> Result<u64, String> {
    let account = state.database.get_account(input.account_id)?;
    save_attachment(
        MailConnectionInput {
            imap_host: account.imap_host,
            imap_port: 993,
            smtp_host: account.smtp_host,
            smtp_port: 587,
            username: account.email,
            password: input.password,
        },
        &input.mailbox_path,
        input.uid,
        input.attachment_position,
        &input.destination,
    )
    .await
}

#[tauri::command]
async fn test_mail_connection(input: MailConnectionInput) -> Result<MailConnectionStatus, String> {
    test_connection(input).await
}

#[tauri::command]
async fn sync_account(
    input: SyncAccountInput,
    state: tauri::State<'_, AppState>,
) -> Result<SyncAccountStatus, String> {
    let account = state.database.get_account(input.account_id)?;
    let snapshot = sync_inbox(MailConnectionInput {
        imap_host: account.imap_host,
        imap_port: 993,
        smtp_host: account.smtp_host,
        smtp_port: 587,
        username: account.email,
        password: input.password,
    })
    .await?;
    let status = SyncAccountStatus {
        mailbox_count: snapshot.mailboxes.len(),
        message_count: snapshot.messages.len(),
    };
    state.database.store_inbox_snapshot(account.id, &snapshot)?;

    Ok(status)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app.path().app_local_data_dir()?;
            let database_path = app_data_dir.join("rmail.sqlite3");
            let salt_path = app_data_dir.join("stronghold-salt.txt");
            let database = Database::open(&database_path).map_err(std::io::Error::other)?;

            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            app.manage(AppState { database });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            create_account,
            delete_account,
            list_cached_mailboxes,
            list_cached_messages,
            load_message_body,
            save_message_attachment,
            test_mail_connection,
            sync_account
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
