//! AI module map
//! Purpose: expose trusted-main commands for SQLite history, logs, queries and exports.
//! Entry: runtime_load/save, database_query/delete/export, and diagnostic_* are
//! registered by lib.rs and build.rs; account and append_error serve native modules.
//! Flow: database.rs owns schema, import and row semantics. Storage's operation lock
//! owns one lazy connection, preserving prepared statements and avoiding repeated WAL
//! setup/close for each operation. Its owned guard travels to blocking workers; FULL
//! synchronous transactions retain the durable sending boundary. Shutdown/update still
//! wait on this same lock. Exports stream a separate read transaction without the lock.
//! Invariants: reads, deletion and export require main origin and native authorization;
//! saving results and logging remain available after expiry. Source account data is not
//! cleared by initialization. write_json serves separate license, cookie and browser data.

use serde_json::{json, Value};
use std::{collections::HashSet, io::{BufWriter, Write}, path::Path, sync::Arc};
use tauri::{AppHandle, Emitter, Manager, Webview};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;
use crate::database;

#[derive(Default)]
pub struct Storage(pub Arc<Mutex<Option<rusqlite::Connection>>>);

pub fn write_json<T: serde::Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), Box<dyn std::error::Error>> {
    let temp = path.with_extension("tmp");
    let mut options = std::fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = BufWriter::new(options.open(&temp)?);
    serde_json::to_writer(&mut file, value)?;
    file.flush()?;
    file.get_ref().sync_all()?;
    std::fs::rename(temp, path)?;
    Ok(())
}

async fn with_database<T: Send + 'static>(
    app: &AppHandle,
    operation: impl FnOnce(&mut rusqlite::Connection) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let mut connection = app.state::<Storage>().0.clone().lock_owned().await;
    let directory = crate::data_dir(app);
    tauri::async_runtime::spawn_blocking(move || {
        if connection.is_none() {
            *connection = Some(database::open(&directory)?);
        }
        operation(connection.as_mut().unwrap())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn runtime_load(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    crate::license::require_valid(&app)?;
    with_database(&app, database::load).await
}

#[tauri::command]
pub async fn runtime_save(app: AppHandle, webview: Webview, data: Value) -> Result<Value, String> {
    crate::require_main(&webview)?;
    // Saving remains available during expiry/shutdown; no platform operation occurs here.
    with_database(&app, move |db| database::save(db, &data)).await
}

#[tauri::command]
pub async fn database_query(app: AppHandle, webview: Webview, request: Value) -> Result<Value, String> {
    crate::require_main(&webview)?;
    crate::license::require_valid(&app)?;
    with_database(&app, move |db| database::query(db, &request)).await
}

#[tauri::command]
pub async fn database_delete(app: AppHandle, webview: Webview, request: Value) -> Result<Value, String> {
    crate::require_main(&webview)?;
    crate::license::require_valid(&app)?;
    let handle = app.clone();
    with_database(&app, move |db| {
        // Keep new task registration outside the deletion transaction.
        let tasks = handle.state::<crate::Tasks>();
        let running = tasks.0.lock().unwrap();
        let running_ids = running.keys().cloned().collect();
        database::delete(db, &request, &running_ids)
    }).await
}

async fn append_entry(app: &AppHandle, entry: Value) -> Result<(), String> {
    with_database(app, move |db| database::append_log(db, &entry)).await
}

#[tauri::command]
pub async fn diagnostic_append(app: AppHandle, webview: Webview, entry: Value) -> Result<(), String> {
    crate::require_main(&webview)?;
    if entry["level"] == "error" { append_entry(&app, entry).await?; }
    Ok(())
}

pub fn append_error(app: &AppHandle, entry: Value) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match append_entry(&app, entry).await {
            Ok(()) => { let _ = app.emit("assistant:event", json!({"type":"database"})); }
            Err(error) => { let _ = app.emit("assistant:event", json!({"type":"error","message":format!("错误日志保存失败：{error}")})); }
        }
    });
}

pub async fn account(app: &AppHandle, id: String) -> Result<Value, String> {
    with_database(app, move |db| database::account(db, &id)).await
}

#[tauri::command]
pub async fn diagnostic_clear(app: AppHandle, webview: Webview, platform: Option<String>, account_id: Option<String>, before: String) -> Result<(), String> {
    crate::require_main(&webview)?;
    crate::license::require_valid(&app)?;
    with_database(&app, move |db| {
        database::delete(db, &json!({"kind":"logs","platform":platform,"accountId":account_id,"before":before}), &HashSet::new())?;
        Ok(())
    }).await
}

#[tauri::command]
pub async fn export_csv(app: AppHandle, webview: Webview, filename: String, content: String) -> Result<bool, String> {
    crate::require_main(&webview)?;
    crate::license::require_valid(&app)?;
    let window = webview.window();
    tauri::async_runtime::spawn_blocking(move || {
        let destination = app.dialog().file().set_parent(&window).set_title("导出 CSV")
            .set_file_name(filename).add_filter("CSV 文件", &["csv"]).blocking_save_file();
        let Some(destination) = destination else { return Ok(false); };
        std::fs::write(destination.into_path().map_err(|e| e.to_string())?, content).map_err(|e| e.to_string())?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn database_export(app: AppHandle, webview: Webview, request: Value) -> Result<Value, String> {
    crate::require_main(&webview)?;
    crate::license::require_valid(&app)?;
    let (filename,extension,title) = match request["kind"].as_str() {
        Some("talents") => ("采集达人.csv","csv","导出采集达人"),
        Some("records") => ("邀约记录.csv","csv","导出邀约记录"),
        Some("logs") => ("大懒虫-错误日志.ndjson","ndjson","导出错误日志"),
        _ => return Err("导出类型无效".into()),
    };
    let window = webview.window();
    tauri::async_runtime::spawn_blocking(move || {
        let destination = app.dialog().file().set_parent(&window).set_title(title)
            .set_file_name(filename).add_filter(title, &[extension]).blocking_save_file();
        let Some(destination) = destination else { return Ok(json!({"saved":false,"count":0})); };
        crate::license::require_valid(&app)?;
        // Runtime initialization owns schema creation. A WAL read transaction gives
        // the export a consistent view while collection and invitations keep writing.
        let mut db = rusqlite::Connection::open_with_flags(crate::data_dir(&app).join("assistant.sqlite3"),rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
        let transaction = db.transaction().map_err(|e| e.to_string())?;
        let mut writer = BufWriter::new(std::fs::File::create(destination.into_path().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?);
        let count = database::export(&transaction, &request, &mut writer)?;
        writer.flush().map_err(|e| e.to_string())?;
        transaction.commit().map_err(|e| e.to_string())?;
        Ok(json!({"saved":true,"count":count}))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn diagnostic_export(app: AppHandle, webview: Webview, account_id: String) -> Result<bool, String> {
    let result = database_export(app, webview, json!({"kind":"logs","accountId":account_id})).await?;
    Ok(result["saved"] == true)
}
