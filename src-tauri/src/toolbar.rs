use crate::overlay::Bounds;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl};

pub struct Toolbar {
    current: Mutex<Option<(Bounds, Value)>>,
    height: Mutex<f64>,
}

impl Default for Toolbar {
    fn default() -> Self {
        Self {
            current: Mutex::new(None),
            height: Mutex::new(88.0),
        }
    }
}

fn rect(bounds: &Bounds, height: f64) -> Rect {
    Rect {
        position: LogicalPosition::new(bounds.left, bounds.top + bounds.height - height).into(),
        size: LogicalSize::new(bounds.width, height).into(),
    }
}

#[tauri::command]
pub async fn toolbar_sync(
    app: AppHandle,
    webview: Webview,
    bounds: Option<Bounds>,
    state: Option<Value>,
) -> Result<(), String> {
    crate::require_main(&webview)?;
    let toolbar = app.state::<Toolbar>();
    let mut current = toolbar.current.lock().unwrap();
    *current = bounds.zip(state);
    let Some((bounds, state)) = current.as_ref() else {
        *toolbar.height.lock().unwrap() = 88.0;
        if let Some(view) = app.get_webview("toolbar") {
            view.close().map_err(|e| e.to_string())?;
        }
        return Ok(());
    };
    if let Some(view) = app.get_webview("toolbar") {
        view.set_bounds(rect(bounds, *toolbar.height.lock().unwrap()))
            .map_err(|e| e.to_string())?;
        view.emit("assistant:toolbar", state)
            .map_err(|e| e.to_string())?;
        view.show().map_err(|e| e.to_string())?;
    } else {
        app.get_window("main")
            .ok_or("主窗口不存在")?
            .add_child(
                tauri::webview::WebviewBuilder::new(
                    "toolbar",
                    WebviewUrl::App("toolbar.html".into()),
                )
                .transparent(true)
                .focused(false)
                .on_navigation(|url| {
                    matches!(
                        url.host_str(),
                        Some("localhost" | "tauri.localhost" | "127.0.0.1")
                    )
                }),
                LogicalPosition::new(bounds.left, bounds.top + bounds.height - 88.0),
                LogicalSize::new(bounds.width, 88.0),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn toolbar_ready(app: AppHandle, webview: Webview) -> Result<Option<Value>, String> {
    require_toolbar(&webview)?;
    Ok(app
        .state::<Toolbar>()
        .current
        .lock()
        .unwrap()
        .as_ref()
        .map(|(_, state)| state.clone()))
}

#[tauri::command]
pub async fn toolbar_resize(app: AppHandle, webview: Webview, height: f64) -> Result<(), String> {
    require_toolbar(&webview)?;
    let toolbar = app.state::<Toolbar>();
    let current = toolbar.current.lock().unwrap();
    if let Some((bounds, _)) = current.as_ref() {
        *toolbar.height.lock().unwrap() = height;
        webview
            .set_bounds(rect(bounds, height))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn toolbar_action(
    app: AppHandle,
    webview: Webview,
    account_id: String,
    action: Value,
) -> Result<(), String> {
    require_toolbar(&webview)?;
    // Only the main UI handles actions; the toolbar cannot call business commands.
    app.emit_to(
        "main",
        "assistant:toolbar-action",
        json!({ "accountId": account_id, "action": action }),
    )
    .map_err(|e| e.to_string())
}

fn require_toolbar(webview: &Webview) -> Result<(), String> {
    if webview.label() == "toolbar" {
        Ok(())
    } else {
        Err("此页面无权操作采集工具栏".into())
    }
}
