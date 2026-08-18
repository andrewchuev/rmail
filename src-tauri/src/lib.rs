mod google_oauth;
mod imap_pool;
mod mail;
mod storage;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use imap_pool::ImapSessionPool;
use keyring::Entry;
use mail::{
    fetch_message_text, save_attachment, send_outgoing_message, sync_mailboxes, test_connection,
    MailConnectionInput, MailConnectionStatus, MessageBody, OutgoingMessageInput,
};
use serde::{Deserialize, Serialize};
use storage::{
    Account, CachedMailbox, CachedMessage, CreateAccountInput, Database, Draft,
    NotificationExclusion, SaveDraftInput, UpdateAccountInput,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

struct AppState {
    database: Database,
    imap_pool: ImapSessionPool,
}

struct WindowSettings {
    hide_on_close: AtomicBool,
}

const CREDENTIAL_SERVICE: &str = "com.rmail.desktop";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncAccountInput {
    account_id: i64,
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
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAttachmentInput {
    account_id: i64,
    mailbox_path: String,
    uid: u32,
    attachment_position: usize,
    destination: std::path::PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageInput {
    account_id: i64,
    message: OutgoingMessageInput,
}

/// Reads the account's IMAP/SMTP password from the OS keyring. `save_credentials`
/// always writes the same value to both the `imapPassword` and `smtpPassword`
/// entries, so either one reflects the account's current password.
fn stored_password(account_id: i64) -> Result<String, String> {
    let entry = Entry::new(
        CREDENTIAL_SERVICE,
        &format!("account:{}:imapPassword", account_id),
    )
    .map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(password),
        Err(keyring::Error::NoEntry) => Err(
            "Stored credentials were not found. Re-enter the account password in Settings."
                .to_string(),
        ),
        Err(error) => Err(error.to_string()),
    }
}

/// Builds mail server connection details for an account, resolving its secret
/// (OAuth token or stored password) on the backend instead of accepting it
/// from the frontend.
async fn mail_connection(account: &Account) -> Result<MailConnectionInput, String> {
    let (password, oauth_access_token) = if account.auth_type == "gmail_oauth" {
        (
            String::new(),
            Some(google_oauth::access_token(&account.email).await?),
        )
    } else {
        (stored_password(account.id)?, None)
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
    mailbox_path: String,
    uid: u32,
}

#[tauri::command]
async fn mark_message_read(
    input: MarkMessageReadInput,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let account = state.database.get_account(input.account_id)?;
    state.database.mark_message_read(account.id, &input.mailbox_path, input.uid)?;

    let connection = mail_connection(&account).await?;
    if let Err(error) = crate::mail::mark_message_read(
        &state.imap_pool,
        account.id,
        connection,
        &input.mailbox_path,
        input.uid,
    )
    .await
    {
        tauri_plugin_log::log::error!(
            "mark_message_read remote sync failed for account {}: {}",
            input.account_id,
            error
        );
        return Err(error);
    }

    Ok(())
}

/// Identifies a single cached message by account, mailbox, and IMAP UID.
/// Shared by every command that operates on a batch of messages, since the
/// frontend sends the same `MessageRef` shape for all of them.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageLocator {
    account_id: i64,
    mailbox_path: String,
    uid: u32,
}

/// Groups message locators by (account, mailbox) so a batch operation issues
/// one IMAP command per mailbox instead of one per message.
fn group_by_mailbox(messages: Vec<MessageLocator>) -> HashMap<(i64, String), Vec<u32>> {
    let mut groups: HashMap<(i64, String), Vec<u32>> = HashMap::new();
    for msg in messages {
        groups.entry((msg.account_id, msg.mailbox_path)).or_default().push(msg.uid);
    }
    groups
}

#[tauri::command]
async fn mark_multiple_messages_read(
    messages: Vec<MessageLocator>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let groups = group_by_mailbox(messages);

    let mut sync_errors = Vec::new();
    for ((account_id, mailbox_path), uids) in groups {
        let account = state.database.get_account(account_id)?;
        state.database.mark_messages_read_bulk(account_id, &mailbox_path, &uids)?;

        let connection = match mail_connection(&account).await {
            Ok(connection) => connection,
            Err(error) => {
                sync_errors.push(format!("account {account_id}: {error}"));
                continue;
            }
        };
        if let Err(error) = crate::mail::mark_messages_read_bulk(
            &state.imap_pool,
            account_id,
            connection,
            &mailbox_path,
            &uids,
        )
        .await
        {
            sync_errors.push(format!("account {account_id}: {error}"));
        }
    }

    if sync_errors.is_empty() {
        Ok(())
    } else {
        let message = sync_errors.join("; ");
        tauri_plugin_log::log::error!("mark_multiple_messages_read remote sync failed: {message}");
        Err(message)
    }
}

#[tauri::command]
async fn delete_messages(
    messages: Vec<MessageLocator>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let groups = group_by_mailbox(messages);

    let mut sync_errors = Vec::new();
    for ((account_id, mailbox_path), uids) in groups {
        let account = state.database.get_account(account_id)?;
        state.database.delete_cached_messages(account_id, &mailbox_path, &uids)?;

        let connection = match mail_connection(&account).await {
            Ok(connection) => connection,
            Err(error) => {
                sync_errors.push(format!("account {account_id}: {error}"));
                continue;
            }
        };
        if let Err(error) = crate::mail::delete_messages(
            &state.imap_pool,
            account_id,
            connection,
            &mailbox_path,
            &uids,
        )
        .await
        {
            sync_errors.push(format!("account {account_id}: {error}"));
        }
    }

    if sync_errors.is_empty() {
        Ok(())
    } else {
        let message = sync_errors.join("; ");
        tauri_plugin_log::log::error!("delete_messages remote sync failed: {message}");
        Err(message)
    }
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
async fn save_credentials(
    account_id: i64,
    password: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
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

    // The cached IMAP session (if any) was authenticated with the old password.
    state.imap_pool.evict(account_id).await;
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
async fn update_account(
    input: UpdateAccountInput,
    state: tauri::State<'_, AppState>,
) -> Result<Account, String> {
    let account = state.database.update_account(input)?;
    // Connection settings may have changed; drop any cached session for this account.
    state.imap_pool.evict(account.id).await;
    Ok(account)
}

#[tauri::command]
fn rename_account(
    account_id: i64,
    display_name: String,
    state: tauri::State<'_, AppState>,
) -> Result<Account, String> {
    state.database.rename_account(account_id, &display_name)
}

#[tauri::command]
fn set_account_notifications(
    account_id: i64,
    enabled: bool,
    state: tauri::State<'_, AppState>,
) -> Result<Account, String> {
    state
        .database
        .set_account_notifications(account_id, enabled)
}

#[tauri::command]
async fn connect_gmail(state: tauri::State<'_, AppState>) -> Result<Account, String> {
    let authorization = google_oauth::authorize().await?;
    let display_name = gmail_display_name(&authorization.email, &authorization.display_name);
    let account = state
        .database
        .create_gmail_account(&authorization.email, &display_name)?;
    if let Err(error) =
        google_oauth::store_refresh_token(&authorization.email, &authorization.refresh_token)
    {
        let _ = state.database.delete_account(account.id);
        return Err(error);
    }
    Ok(account)
}

/// Formats a new Gmail account's default display name as "email (name)" so
/// two Gmail accounts belonging to the same Google profile name stay
/// distinguishable in the account list. Falls back to the email alone if
/// Google didn't return a distinct name.
fn gmail_display_name(email: &str, name: &str) -> String {
    if name.trim().is_empty() || name.eq_ignore_ascii_case(email) {
        email.to_string()
    } else {
        format!("{email} ({name})")
    }
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
    state.imap_pool.evict(account_id).await;
    Ok(account)
}

#[tauri::command]
async fn delete_account(account_id: i64, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let account = state.database.get_account(account_id)?;
    if account.auth_type == "gmail_oauth" {
        google_oauth::delete_refresh_token(&account.email)?;
    } else {
        let _ = delete_credentials(account_id);
    }
    state.imap_pool.evict(account_id).await;
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
    let connection = mail_connection(&account).await?;
    let body = fetch_message_text(
        &state.imap_pool,
        input.account_id,
        connection,
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
    let connection = mail_connection(&account).await?;
    save_attachment(
        &state.imap_pool,
        input.account_id,
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
    let connection = match mail_connection(&account).await {
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
    let connection = match mail_connection(&account).await {
        Ok(c) => c,
        Err(e) => {
            tauri_plugin_log::log::error!("sync_account connection failed for account {}: {}", input.account_id, e);
            return Err(e);
        }
    };

    let snapshot = match sync_mailboxes(&state.imap_pool, account.id, connection).await {
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
fn flush_message_cache(state: tauri::State<'_, AppState>) -> Result<(), String> {
    tauri_plugin_log::log::info!("flush_message_cache started");
    match state.database.flush_message_cache() {
        Ok((mailbox_count, message_count)) => {
            tauri_plugin_log::log::info!(
                "flush_message_cache completed: cleared {mailbox_count} mailboxes, {message_count} messages"
            );
            Ok(())
        }
        Err(error) => {
            tauri_plugin_log::log::error!("flush_message_cache failed: {error}");
            Err(error)
        }
    }
}

#[tauri::command]
fn list_notification_exclusions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<NotificationExclusion>, String> {
    state.database.list_notification_exclusions()
}

#[tauri::command]
fn add_notification_exclusion(
    sender: String,
    state: tauri::State<'_, AppState>,
) -> Result<NotificationExclusion, String> {
    state.database.add_notification_exclusion(&sender)
}

#[tauri::command]
fn remove_notification_exclusion(
    id: i64,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.database.remove_notification_exclusion(id)
}

#[tauri::command]
fn set_tray_unread_state(app: tauri::AppHandle, has_unread: bool) -> Result<(), String> {
    tauri_plugin_log::log::debug!("set_tray_unread_state called with has_unread: {has_unread}");
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
                        && let Some(window) = tray.app_handle().get_webview_window("main")
                    {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                })
                .build(app)?;
            app.manage(AppState {
                database,
                imap_pool: ImapSessionPool::new(),
            });
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
            rename_account,
            set_account_notifications,
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
            delete_messages,
            flush_message_cache,
            list_notification_exclusions,
            add_notification_exclusion,
            remove_notification_exclusion,
            set_tray_unread_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::gmail_display_name;

    #[test]
    fn formats_gmail_display_name_with_email_first() {
        assert_eq!(
            gmail_display_name("person@gmail.com", "Person Name"),
            "person@gmail.com (Person Name)"
        );
    }

    #[test]
    fn falls_back_to_email_alone_without_a_distinct_name() {
        assert_eq!(gmail_display_name("person@gmail.com", ""), "person@gmail.com");
        assert_eq!(
            gmail_display_name("person@gmail.com", "person@gmail.com"),
            "person@gmail.com"
        );
    }
}
