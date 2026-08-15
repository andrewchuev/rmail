mod storage;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let database_path = app.path().app_local_data_dir()?.join("rmail.sqlite3");
            let database = Database::open(&database_path).map_err(std::io::Error::other)?;
            app.manage(AppState { database });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_accounts, create_account])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
