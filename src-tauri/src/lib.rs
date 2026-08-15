mod google_oauth;
mod mail;
mod storage;

use std::sync::atomic::{AtomicBool, Ordering};

use keyring::Entry;
use mail::{
    fetch_message_text, save_attachment, send_outgoing_message, sync_mailboxes, test_connection,
    MailConnectionInput, MailConnectionStatus, MessageBody, OutgoingMessageInput,
};
use serde::{Deserialize, Serialize};
use storage::{
    Account, CachedMailbox, CachedMessage, CreateAccountInput, Database, Draft, SaveDraftInput,
    UpdateAccountInput,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

struct AppState {
    database: Database,
}

struct WindowSettings {
    hide_on_close: AtomicBool,
}

const CREDENTIAL_SERVICE: &str = "com.rmail.desktop";

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

async fn mail_connection(
    account: &Account,
    password: String,
) -> Result<MailConnectionInput, String> {
    let oauth_access_token = if account.auth_type == "gmail_oauth" {
        Some(google_oauth::access_token(&account.email).await?)
    } else {
        None
    };
    Ok(MailConnectionInput {
        imap_host: account.imap_host.clone(),
        imap_port: 993,
        smtp_host: account.smtp_host.clone(),
        smtp_port: 587,
        username: account.email.clone(),
        password,
        oauth_access_token,
    })
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
fn save_credentials(account_id: i64, password: String) -> Result<(), String> {
    let imap_entry = Entry::new(
        CREDENTIAL_SERVICE,
        &format!("account:{}:imapPassword", account_id),
    )
    .map_err(|error| error.to_string())?;
    imap_entry
        .set_password(&password)
        .map_err(|error| error.to_string())?;

    let smtp_entry = Entry::new(
        CREDENTIAL_SERVICE,
        &format!("account:{}:smtpPassword", account_id),
    )
    .map_err(|error| error.to_string())?;
    smtp_entry
        .set_password(&password)
        .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn read_credential(account_id: i64, name: String) -> Result<Option<String>, String> {
    let entry = Entry::new(
        CREDENTIAL_SERVICE,
        &format!("account:{}:{}", account_id, name),
    )
    .map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn delete_credentials(account_id: i64) -> Result<(), String> {
    let imap_entry = Entry::new(
        CREDENTIAL_SERVICE,
        &format!("account:{}:imapPassword", account_id),
    )
    .map_err(|error| error.to_string())?;
    let _ = imap_entry.delete_credential();

    let smtp_entry = Entry::new(
        CREDENTIAL_SERVICE,
        &format!("account:{}:smtpPassword", account_id),
    )
    .map_err(|error| error.to_string())?;
    let _ = smtp_entry.delete_credential();

    Ok(())
}

#[tauri::command]
fn set_hide_on_close(enabled: bool, settings: tauri::State<'_, WindowSettings>) {
    settings.hide_on_close.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn create_account(
    input: CreateAccountInput,
    state: tauri::State<'_, AppState>,
) -> Result<Account, String> {
    state.database.create_account(input)
}

#[tauri::command]
fn update_account(
    input: UpdateAccountInput,
    state: tauri::State<'_, AppState>,
) -> Result<Account, String> {
    state.database.update_account(input)
}

#[tauri::command]
async fn connect_gmail(state: tauri::State<'_, AppState>) -> Result<Account, String> {
    let authorization = google_oauth::authorize().await?;
    let account = state
        .database
        .create_gmail_account(&authorization.email, &authorization.display_name)?;
    if let Err(error) =
        google_oauth::store_refresh_token(&authorization.email, &authorization.refresh_token)
    {
        let _ = state.database.delete_account(account.id);
        return Err(error);
    }
    Ok(account)
}

#[tauri::command]
async fn reconnect_gmail(
    account_id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<Account, String> {
    let account = state.database.get_account(account_id)?;
    if account.auth_type != "gmail_oauth" {
        return Err("The selected account does not use Google OAuth.".to_string());
    }

    let authorization = google_oauth::authorize().await?;
    if !authorization.email.eq_ignore_ascii_case(&account.email) {
        return Err(format!(
            "Authorize {} to reconnect this account.",
            account.email
        ));
    }
    google_oauth::store_refresh_token(&account.email, &authorization.refresh_token)?;
    Ok(account)
}

#[tauri::command]
fn delete_account(account_id: i64, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let account = state.database.get_account(account_id)?;
    if account.auth_type == "gmail_oauth" {
        google_oauth::delete_refresh_token(&account.email)?;
    } else {
        let _ = delete_credentials(account_id);
    }
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
    let connection = mail_connection(&account, input.password).await?;
    let body = fetch_message_text(connection, &input.mailbox_path, input.uid).await?;
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
    let connection = mail_connection(&account, input.password).await?;
    save_attachment(
        connection,
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
    let connection = mail_connection(&account, input.password).await?;
    send_outgoing_message(connection, &account.display_name, input.message).await
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
    let connection = mail_connection(&account, input.password).await?;
    let snapshot = sync_mailboxes(connection).await?;
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
        .plugin(tauri_plugin_window_state::Builder::new().build())
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
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            let app_data_dir = app.path().app_local_data_dir()?;
            let database_path = app_data_dir.join("rmail.sqlite3");
            let database = Database::open(&database_path).map_err(std::io::Error::other)?;
            
            use tauri_plugin_autostart::ManagerExt;
            let is_autostart = app.autolaunch().is_enabled().unwrap_or(false);
            
            let open = MenuItem::with_id(app, "open", "Open RMail", true, None::<&str>)?;
            let sync = MenuItem::with_id(app, "sync", "Synchronize now", true, None::<&str>)?;
            let autostart = tauri::menu::CheckMenuItem::with_id(app, "autostart", "Launch on startup", true, is_autostart, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &sync, &autostart, &separator, &quit])?;
            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("RMail")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = app.emit("tray-show", ());
                    }
                    "sync" => {
                        let _ = app.emit("tray-sync", ());
                    }
                    "autostart" => {
                        use tauri_plugin_autostart::ManagerExt;
                        let autostart_manager = app.autolaunch();
                        let current = autostart_manager.is_enabled().unwrap_or(false);
                        if current {
                            let _ = autostart_manager.disable();
                        } else {
                            let _ = autostart_manager.enable();
                        }
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
            app.manage(WindowSettings {
                hide_on_close: AtomicBool::new(true),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !window
                    .state::<WindowSettings>()
                    .hide_on_close
                    .load(Ordering::Relaxed)
                {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            diagnostic_log_path,
            list_accounts,
            save_credentials,
            read_credential,
            delete_credentials,
            set_hide_on_close,
            create_account,
            update_account,
            connect_gmail,
            reconnect_gmail,
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
