use serde_json::{json, Value};
use std::{io::Write, path::Path};
use tauri::{AppHandle, Manager, Webview};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct Storage(pub Mutex<()>);

pub fn write_json(path: &Path, value: &Value) -> Result<(), Box<dyn std::error::Error>> {
    let temp = path.with_extension("tmp");
    let mut options = std::fs::OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temp)?;
    serde_json::to_writer(&mut file, value)?;
    file.sync_all()?;
    std::fs::rename(temp, path)?;
    Ok(())
}

fn read_logs(directory: &Path) -> Result<Vec<Value>, String> {
    let file = directory.join("errors.ndjson");
    if !file.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(file).map_err(|e| e.to_string())?;
    let mut logs = content
        .lines()
        .filter(|s| !s.is_empty())
        .map(serde_json::from_str::<Value>)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    logs.retain(|entry| entry["level"] == "error");
    Ok(logs)
}

#[tauri::command]
pub async fn runtime_load(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    crate::license::require_valid(&app).await?;
    let storage = app.state::<Storage>();
    let _lock = storage.0.lock().await;
    let directory = crate::data_dir(&app);
    let file = directory.join("runtime.json");
    let mut data = if file.exists() {
        serde_json::from_slice(&std::fs::read(file).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?
    } else {
        json!({"records":[],"talents":[],"tasks":{},"collections":[]})
    };
    let logs = read_logs(&directory)?;
    data["logs"] = json!(&logs[logs.len().saturating_sub(1000)..]);
    Ok(data)
}

#[tauri::command]
pub async fn runtime_save(app: AppHandle, webview: Webview, mut data: Value) -> Result<(), String> {
    crate::require_main(&webview)?;
    let storage = app.state::<Storage>();
    let _lock = storage.0.lock().await;
    data.as_object_mut()
        .ok_or("运行记录格式无效")?
        .remove("logs");
    write_json(&crate::data_dir(&app).join("runtime.json"), &data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn diagnostic_append(
    app: AppHandle,
    webview: Webview,
    entry: Value,
) -> Result<(), String> {
    crate::require_main(&webview)?;
    if entry["level"] != "error" {
        return Ok(());
    }
    let storage = app.state::<Storage>();
    let _lock = storage.0.lock().await;
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(crate::data_dir(&app).join("errors.ndjson"))
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", entry).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn diagnostic_export(app: AppHandle, webview: Webview) -> Result<bool, String> {
    crate::require_main(&webview)?;
    let destination = app
        .dialog()
        .file()
        .set_title("导出错误日志")
        .set_file_name("大懒虫-错误日志.ndjson")
        .add_filter("错误日志", &["ndjson"])
        .blocking_save_file();
    let Some(destination) = destination else {
        return Ok(false);
    };
    let logs = read_logs(&crate::data_dir(&app))?;
    let content = logs.iter().map(|v| format!("{v}\n")).collect::<String>();
    std::fs::write(destination.into_path().map_err(|e| e.to_string())?, content)
        .map_err(|e| e.to_string())?;
    Ok(true)
}
