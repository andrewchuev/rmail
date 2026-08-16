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


#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkMessageReadInput {
    account_id: i64,
    password: String,
    mailbox_path: String,
    uid: u32,
}

#[tauri::command]
fn mark_message_read(
    input: MarkMessageReadInput,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let account = state.database.get_account(input.account_id)?;
    state.database.mark_message_read(account.id, &input.mailbox_path, input.uid)?;

    tauri::async_runtime::spawn(async move {
        if let Ok(connection) = mail_connection(&account, input.password).await {
            let _ = crate::mail::mark_message_read(connection, &input.mailbox_path, input.uid).await;
        }
    });

    Ok(())
}


use std::collections::HashMap;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkMultipleMessagesReadInput {
    account_id: i64,
    password: String,
    mailbox_path: String,
    uid: u32,
}

#[tauri::command]
fn mark_multiple_messages_read(
    messages: Vec<MarkMultipleMessagesReadInput>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // Group by (account_id, password, mailbox_path)
    let mut groups: HashMap<(i64, String, String), Vec<u32>> = HashMap::new();
    for msg in messages {
        groups.entry((msg.account_id, msg.password, msg.mailbox_path)).or_default().push(msg.uid);
    }

    for ((account_id, password, mailbox_path), uids) in groups {
        let account = state.database.get_account(account_id)?;
        state.database.mark_messages_read_bulk(account_id, &mailbox_path, &uids)?;

        tauri::async_runtime::spawn(async move {
            if let Ok(connection) = mail_connection(&account, password).await {
                let _ = crate::mail::mark_messages_read_bulk(connection, &mailbox_path, &uids).await;
            }
        });
    }

    Ok(())
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
    tauri_plugin_log::log::info!("send_message started for account {}", input.account_id);
    let account = state.database.get_account(input.account_id)?;
    let connection = match mail_connection(&account, input.password).await {
        Ok(c) => c,
        Err(e) => {
            tauri_plugin_log::log::error!("send_message connection failed for account {}: {}", input.account_id, e);
            return Err(e);
        }
    };
    
    match send_outgoing_message(connection, &account.display_name, input.message).await {
        Ok(_) => {
            tauri_plugin_log::log::info!("send_message completed for account {}", input.account_id);
            Ok(())
        }
        Err(e) => {
            tauri_plugin_log::log::error!("send_message failed for account {}: {}", input.account_id, e);
            Err(e)
        }
    }
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
    tauri_plugin_log::log::info!("sync_account started for account {}", input.account_id);
    let account = state.database.get_account(input.account_id)?;
    let connection = match mail_connection(&account, input.password).await {
        Ok(c) => c,
        Err(e) => {
            tauri_plugin_log::log::error!("sync_account connection failed for account {}: {}", input.account_id, e);
            return Err(e);
        }
    };
    
    let snapshot = match sync_mailboxes(connection).await {
        Ok(s) => s,
        Err(e) => {
            tauri_plugin_log::log::error!("sync_account sync_mailboxes failed for account {}: {}", input.account_id, e);
            return Err(e);
        }
    };

    let status = SyncAccountStatus {
        mailbox_count: snapshot.mailboxes.len(),
        message_count: snapshot.messages.len(),
    };
    
    if let Err(e) = state.database.store_inbox_snapshot(account.id, &snapshot) {
        tauri_plugin_log::log::error!("sync_account store_inbox_snapshot failed for account {}: {}", input.account_id, e);
        return Err(e);
    }

    tauri_plugin_log::log::info!("sync_account completed for account {}", input.account_id);
    Ok(status)
}


#[tauri::command]
fn set_tray_unread_state(app: tauri::AppHandle, has_unread: bool) -> Result<(), String> {
    println!("set_tray_unread_state called with has_unread: {}", has_unread);
    if let Some(tray) = app.tray_by_id("main-tray") {
        let icon = if has_unread {
            tauri::image::Image::from_bytes(include_bytes!("../icons/icon-unread.png"))
                .map_err(|e| e.to_string())?
        } else {
            app.default_window_icon().cloned().ok_or_else(|| "Default window icon must be set".to_string())?
        };
        let _ = tray.set_icon(Some(icon));
    }
    Ok(())
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
            let window_icon = app.default_window_icon().cloned();
            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .tooltip("RMail");
            if let Some(icon) = window_icon {
                tray_builder = tray_builder.icon(icon);
            }
            tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
            sync_account,
            mark_message_read,
            mark_multiple_messages_read,
            set_tray_unread_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
