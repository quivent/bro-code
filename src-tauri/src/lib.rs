use rusqlite::Connection;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

// ── Settings (SQLite) ──

struct DbState(Mutex<Connection>);

fn db_path() -> PathBuf {
    let dirs = directories::ProjectDirs::from("com", "bro", "code")
        .expect("could not determine data directory");
    let data = dirs.data_dir();
    std::fs::create_dir_all(data).ok();
    data.join("bro.db")
}

fn init_db() -> Connection {
    let conn = Connection::open(db_path()).expect("could not open database");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .expect("could not create settings table");
    conn
}

#[tauri::command]
fn get_setting(key: String, state: State<DbState>) -> Option<String> {
    let conn = state.0.lock().unwrap();
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [&key],
        |row| row.get(0),
    )
    .ok()
}

#[tauri::command]
fn set_setting(key: String, value: String, state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().unwrap();
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        [&key, &value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_all_settings(state: State<DbState>) -> Vec<(String, String)> {
    let conn = state.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .unwrap();
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
}

// ── File I/O (for prompt.md, memory.json) ──

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    let expanded = if path.starts_with("~/") {
        let home = dirs_home().unwrap_or_default();
        home.join(&path[2..])
    } else {
        PathBuf::from(&path)
    };
    std::fs::read_to_string(&expanded).map_err(|e| format!("{}: {}", expanded.display(), e))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    let expanded = if path.starts_with("~/") {
        let home = dirs_home().unwrap_or_default();
        home.join(&path[2..])
    } else {
        PathBuf::from(&path)
    };
    if let Some(parent) = expanded.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&expanded, &content).map_err(|e| format!("{}: {}", expanded.display(), e))
}

#[tauri::command]
fn run_shell(cmd: String) -> Result<String, String> {
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(&cmd)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if output.status.success() {
        Ok(stdout.to_string())
    } else {
        Ok(format!("{}{}", stdout, stderr))
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

// ── App config ──

#[derive(Serialize)]
struct AppInfo {
    version: String,
    data_dir: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        data_dir: db_path()
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
    }
}

// ── Run ──

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = init_db();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(DbState(Mutex::new(db)))
        .invoke_handler(tauri::generate_handler![
            get_setting,
            set_setting,
            get_all_settings,
            app_info,
            read_file,
            write_file,
            run_shell,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bro");
}
