mod mail;
mod storage;

use keyring::Entry;
use mail::{
    fetch_message_text, save_attachment, send_outgoing_message, sync_mailboxes, test_connection,
    MailConnectionInput, MailConnectionStatus, MessageBody, OutgoingMessageInput,
};
use serde::{Deserialize, Serialize};
use storage::{
    Account, CachedMailbox, CachedMessage, CreateAccountInput, Database, Draft, SaveDraftInput,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

struct AppState {
    database: Database,
}

const VAULT_PASSWORD_SERVICE: &str = "com.rmail.desktop";
const VAULT_PASSWORD_ACCOUNT: &str = "stronghold-master-password";

fn vault_password_entry() -> Result<Entry, String> {
    Entry::new(VAULT_PASSWORD_SERVICE, VAULT_PASSWORD_ACCOUNT).map_err(|error| error.to_string())
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageInput {
    account_id: i64,
    password: String,
    message: OutgoingMessageInput,
}

#[tauri::command]
fn diagnostic_log_path(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .app_log_dir()
        .map(|directory| {
            directory
                .join("rmail-diagnostics.log")
                .display()
                .to_string()
        })
        .map_err(|_| "Unable to locate the diagnostic log.".to_string())
}

#[tauri::command]
fn list_accounts(state: tauri::State<'_, AppState>) -> Result<Vec<Account>, String> {
    state.database.list_accounts()
}

#[tauri::command]
fn load_stored_vault_password() -> Result<Option<String>, String> {
    Ok(vault_password_entry()?.get_password().ok())
}

#[tauri::command]
fn save_stored_vault_password(password: String) -> Result<(), String> {
    if password.is_empty() {
        return Err("The vault password cannot be empty.".to_string());
    }

    vault_password_entry()?
        .set_password(&password)
        .map_err(|error| error.to_string())
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
fn save_draft(input: SaveDraftInput, state: tauri::State<'_, AppState>) -> Result<Draft, String> {
    state.database.save_draft(input)
}

#[tauri::command]
fn delete_draft(draft_id: i64, state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.database.delete_draft(draft_id)
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
fn list_unified_inbox(state: tauri::State<'_, AppState>) -> Result<Vec<CachedMessage>, String> {
    state.database.list_unified_inbox()
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
async fn send_message(
    input: SendMessageInput,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let account = state.database.get_account(input.account_id)?;
    send_outgoing_message(
        MailConnectionInput {
            imap_host: account.imap_host,
            imap_port: 993,
            smtp_host: account.smtp_host,
            smtp_port: 587,
            username: account.email,
            password: input.password,
        },
        &account.display_name,
        input.message,
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
    let snapshot = sync_mailboxes(MailConnectionInput {
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
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("rmail-diagnostics".to_string()),
                    }),
                ])
                .max_file_size(512_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data_dir = app.path().app_local_data_dir()?;
            let database_path = app_data_dir.join("rmail.sqlite3");
            let salt_path = app_data_dir.join("stronghold-salt.txt");
            let database = Database::open(&database_path).map_err(std::io::Error::other)?;

            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            let open = MenuItem::with_id(app, "open", "Открыть RMail", true, None::<&str>)?;
            let sync =
                MenuItem::with_id(app, "sync", "Синхронизировать сейчас", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &sync, &separator, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("RMail")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = app.emit("tray-show", ());
                    }
                    "sync" => {
                        let _ = app.emit("tray-sync", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = tray.app_handle().emit("tray-show", ());
                    }
                })
                .build(app)?;
            app.manage(AppState { database });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            diagnostic_log_path,
            list_accounts,
            load_stored_vault_password,
            save_stored_vault_password,
            create_account,
            delete_account,
            save_draft,
            delete_draft,
            list_cached_mailboxes,
            list_cached_messages,
            list_unified_inbox,
            load_message_body,
            save_message_attachment,
            send_message,
            test_mail_connection,
            sync_account
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
