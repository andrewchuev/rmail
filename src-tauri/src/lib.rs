mod mail;
mod storage;

use mail::{test_connection, MailConnectionInput, MailConnectionStatus};
use storage::{Account, CreateAccountInput, Database};
use tauri::Manager;

struct AppState {
    database: Database,
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
async fn test_mail_connection(input: MailConnectionInput) -> Result<MailConnectionStatus, String> {
    test_connection(input).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            test_mail_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
