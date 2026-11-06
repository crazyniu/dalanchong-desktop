use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

const RELEASES: &str =
    "https://gitee.com/api/v5/repos/zhenxiaoguo/dalanchong/releases?per_page=100";

pub struct Updates {
    state: std::sync::Mutex<Value>,
    operation: Mutex<()>,
    available: Mutex<Option<Update>>,
    downloaded: Mutex<Option<Vec<u8>>>,
}

impl Updates {
    pub fn new(version: &str) -> Self {
        Self {
            state: std::sync::Mutex::new(
                json!({"currentVersion":version,"status":"idle","canInstall":!cfg!(debug_assertions)}),
            ),
            operation: Mutex::new(()),
            available: Mutex::new(None),
            downloaded: Mutex::new(None),
        }
    }
    fn publish(&self, app: &AppHandle, patch: Value) -> Value {
        let mut state = self.state.lock().unwrap();
        for (key, value) in patch.as_object().unwrap() {
            state[key] = value.clone();
        }
        let _ = app.emit_to(
            "main",
            "assistant:event",
            json!({"type":"update","state":*state}),
        );
        state.clone()
    }
}

pub async fn check(app: &AppHandle) -> Value {
    let updates = app.state::<Updates>();
    let _operation = updates.operation.lock().await;
    let state = updates.state.lock().unwrap().clone();
    if state["status"] == "downloaded" {
        return state;
    }
    updates.publish(
        app,
        json!({"status":"checking","error":null,"percent":null}),
    );
    match check_release(app, &updates).await {
        Ok(state) => state,
        Err(error) => updates.publish(app, json!({"status":"error","error":error})),
    }
}

async fn check_release(app: &AppHandle, updates: &Updates) -> Result<Value, String> {
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?
        .get(RELEASES)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| format!("读取 Gitee Release 失败：{e}"))?;
    let releases: Vec<Value> = response.json().await.map_err(|e| e.to_string())?;
    let current = app.package_info().version.clone();
    let latest = releases
        .iter()
        .filter(|r| r["draft"] != true && r["prerelease"] != true)
        .filter_map(|r| {
            semver::Version::parse(r["tag_name"].as_str()?.trim_start_matches('v'))
                .ok()
                .map(|v| (v, r))
        })
        .filter(|(v, _)| v.pre.is_empty())
        .max_by(|a, b| a.0.cmp(&b.0));
    let Some((version, release)) = latest.filter(|(v, _)| v > &current) else {
        *updates.available.lock().await = None;
        return Ok(updates.publish(
            app,
            json!({"status":"not-available","version":current.to_string(),"releaseNotes":""}),
        ));
    };
    let notes = release["body"].as_str().unwrap_or("");
    if !notes.contains("新增功能") || !notes.contains("问题修复") {
        return Err(format!("v{version} 缺少中文更新说明"));
    }
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("新版本的更新文件尚未发布完整")?;
    if update.version != version.to_string() {
        return Err("版本说明与更新文件不一致".into());
    }
    *updates.available.lock().await = Some(update);
    Ok(updates.publish(
        app,
        json!({"status":"available","version":version.to_string(),"releaseNotes":notes}),
    ))
}

#[tauri::command]
pub async fn update_state(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    Ok(app.state::<Updates>().state.lock().unwrap().clone())
}

#[tauri::command]
pub async fn update_check(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    Ok(check(&app).await)
}

#[tauri::command]
pub async fn update_download(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    let updates = app.state::<Updates>();
    let _operation = updates.operation.lock().await;
    let available = updates.available.lock().await;
    let update = available.as_ref().ok_or("请先检查更新")?;
    updates.publish(
        &app,
        json!({"status":"downloading","percent":0,"error":null}),
    );
    let mut received = 0u64;
    let result = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                if let Some(total) = total.filter(|n| *n > 0) {
                    updates.publish(
                        &app,
                        json!({"percent":received as f64 / total as f64 * 100.0}),
                    );
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(bytes) => {
            *updates.downloaded.lock().await = Some(bytes);
            Ok(updates.publish(&app, json!({"status":"downloaded","percent":100})))
        }
        Err(error) => {
            Ok(updates.publish(&app, json!({"status":"error","error":error.to_string()})))
        }
    }
}

#[tauri::command]
pub async fn update_install(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    if !app.state::<crate::Tasks>().0.lock().unwrap().is_empty() {
        return Err("请先停止正在运行的任务".into());
    }
    let updates = app.state::<Updates>();
    let _operation = updates.operation.lock().await;
    let available = updates.available.lock().await;
    let update = available.as_ref().ok_or("请先检查更新")?;
    let downloaded = updates.downloaded.lock().await;
    let bytes = downloaded.as_ref().ok_or("请先下载更新")?;
    crate::browser::flush_sessions(&app).await?;
    update.install(bytes).map_err(|e| e.to_string())?;
    app.restart();
}
