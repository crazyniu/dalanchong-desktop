//! AI module map
//! Purpose: discover, download, install, and restart signed native application updates.
//! Entry: check runs at startup; update_* commands are accessible only to main.
//! Flow: read version, notes, and artifacts from the Gitee-hosted updater manifest, retain the Update
//! object, download verified bytes, wait for Tasks to empty, close managed Chromium windows,
//! flush native sessions, then install. Browser close failure prevents app installation so profiles can finish saving.
//! State: operation serializes update work; available/downloaded retain retryable state;
//! publish emits UI progress. runtime.mjs coordinates task completion and snapshot saves.
//! Downloaded bytes are shared with the blocking installer without copying the archive;
//! installation retains the storage operation guard until its file work completes.
//! Invariants: debug builds cannot install; release notes and artifact versions share
//! one manifest; no installation may overlap a registered task. Never embed signing secrets or
//! replace signature verification. Success restarts automatically; errors retain retry data.

use serde_json::{json, Value};
use std::{sync::Arc, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

pub struct Updates {
    state: std::sync::Mutex<Value>,
    // Serializes check/download/install without holding the synchronous UI-state lock.
    operation: Mutex<()>,
    available: Mutex<Option<Update>>,
    downloaded: Mutex<Option<Arc<Vec<u8>>>>,
}

#[derive(serde::Serialize)]
struct UpdateEvent<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    state: &'a Value,
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
        let state = {
            let mut state = self.state.lock().unwrap();
            for (key, value) in patch.as_object().unwrap() {
                state[key] = value.clone();
            }
            state.clone()
        };
        // IPC serialization must not hold the state lock used by task-start checks.
        let _ = app.emit_to(
            "main",
            "assistant:event",
            &UpdateEvent { kind: "update", state: &state },
        );
        state
    }

    pub fn is_installing(&self) -> bool {
        self.state.lock().unwrap()["status"] == "installing"
    }

    fn ready_to_install(&self, app: &AppHandle) -> Value {
        let waiting = !app.state::<crate::Tasks>().0.lock().unwrap().is_empty();
        self.publish(
            app,
            json!({"status":if waiting { "waiting" } else { "downloaded" },"percent":100,"error":null,"retryAction":"update"}),
        )
    }
}

pub async fn check(app: &AppHandle) -> Value {
    let updates = app.state::<Updates>();
    let _operation = updates.operation.lock().await;
    let state = updates.state.lock().unwrap().clone();
    if matches!(state["status"].as_str(), Some("downloaded" | "waiting" | "installing")) {
        return state;
    }
    updates.publish(
        app,
        json!({"status":"checking","error":null,"percent":null,"retryAction":"check"}),
    );
    match check_release(app, &updates).await {
        Ok(state) => state,
        Err(error) => updates.publish(app, json!({"status":"error","error":error})),
    }
}

async fn check_release(app: &AppHandle, updates: &Updates) -> Result<Value, String> {
    // Publication writes the same Chinese notes to Release bodies and this manifest
    // after uploading all artifacts. Discovery needs no separate Release API request.
    let update = app
        .updater_builder()
        .version_comparator(|current, release| {
            release.version.pre.is_empty() && release.version > current
        })
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| format!("检查更新失败：{e}"))?;
    let Some(update) = update else {
        *updates.available.lock().await = None;
        *updates.downloaded.lock().await = None;
        return Ok(updates.publish(
            app,
            json!({"status":"not-available","version":app.package_info().version.to_string(),"releaseNotes":""}),
        ));
    };
    let notes = update.body.as_deref().unwrap_or("");
    if !notes.contains("新增功能") || !notes.contains("问题修复") {
        return Err(format!("v{} 缺少中文更新说明", update.version));
    }
    let state = json!({"status":"available","version":update.version,"releaseNotes":notes});
    *updates.available.lock().await = Some(update);
    *updates.downloaded.lock().await = None;
    Ok(updates.publish(app, state))
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
    if cfg!(debug_assertions) {
        return Err("开发版不执行安装更新".into());
    }
    let updates = app.state::<Updates>();
    let _operation = updates.operation.lock().await;
    if updates.downloaded.lock().await.is_some() {
        return Ok(updates.ready_to_install(&app));
    }
    let available = updates.available.lock().await;
    let update = available.as_ref().ok_or("请先检查更新")?;
    updates.publish(
        &app,
        json!({"status":"downloading","percent":0,"error":null,"retryAction":"update"}),
    );
    let mut received = 0u64;
    let mut last_progress = Instant::now();
    let result = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                if let Some(total) = total.filter(|n| *n > 0) {
                    if received < total && last_progress.elapsed() < Duration::from_millis(200) {
                        return;
                    }
                    updates.publish(
                        &app,
                        json!({"percent":received as f64 / total as f64 * 100.0}),
                    );
                    last_progress = Instant::now();
                }
            },
            || {},
        )
        .await;
    match result {
        Ok(bytes) => {
            *updates.downloaded.lock().await = Some(Arc::new(bytes));
            Ok(updates.ready_to_install(&app))
        }
        Err(error) => {
            Ok(updates.publish(&app, json!({"status":"error","error":error.to_string()})))
        }
    }
}

#[tauri::command]
pub async fn update_install(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    if cfg!(debug_assertions) {
        return Err("开发版不执行安装更新".into());
    }
    let updates = app.state::<Updates>();
    let _operation = updates.operation.lock().await;
    let update = updates.available.lock().await.as_ref().ok_or("请先检查更新")?.clone();
    let bytes = updates.downloaded.lock().await.as_ref().ok_or("请先下载更新")?.clone();
    {
        let tasks = app.state::<crate::Tasks>();
        let tasks = tasks.0.lock().unwrap();
        if !tasks.is_empty() {
            return Err("请等待采集或邀约任务结束".into());
        }
        // Publish while Tasks remains locked so a concurrent start cannot slip between
        // the empty-task decision and set_task_state's installing check.
        updates.publish(&app, json!({"status":"installing","error":null,"retryAction":"update"}));
    }
    let result = async {
        crate::chrome::close_all(&app).await?;
        crate::browser::flush_sessions(&app).await?;
        let saved = app.state::<crate::storage::Storage>().0.clone().lock_owned().await;
        tauri::async_runtime::spawn_blocking(move || {
            let _saved = saved;
            update.install(bytes.as_slice()).map_err(|e| e.to_string())
        }).await.map_err(|e| e.to_string())?
    }
    .await;
    if let Err(error) = result {
        return Ok(updates.publish(&app, json!({"status":"error","error":error})));
    }
    app.restart();
}
