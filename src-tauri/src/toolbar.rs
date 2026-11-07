//! AI module map
//! Purpose: host the draggable floating toolbar as a separate transparent native WebView.
//! Entry: main sends bounds/state with toolbar_sync; the toolbar calls ready/resize/move/action.
//! Flow: retain the child through dialogs and account switches, emit assistant:toolbar,
//! and forward user actions back to main as assistant:toolbar-action.
//! State: Toolbar owns current bounds/content, measured height including open menus, and
//! a session-local offset from the default bottom-center placement. Hiding retains the offset.
//! A presentation revision changes only when hidden/restored or switching accounts. The
//! child acknowledges committed content/height before reuse becomes visible; stale
//! acknowledgements and actions cannot target another account. Native sibling ordering
//! is shared with overlay.rs and never changes keyboard focus.
//! Geometry-only synchronization moves the incoming state without cloning it or building
//! an unused event payload; payloads are materialized only for changed presentation/content.
//! Invariants: the toolbar label is the only caller allowed to report toolbar events;
//! only main may synchronize content. This view forwards intent, not business commands.
//! Keep its native bounds aligned with browser.tsx and toolbar-overlay.tsx.

use crate::overlay::Bounds;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl};

pub struct Toolbar {
    current: Mutex<ToolbarState>,
    height: Mutex<f64>,
    offset: Mutex<(f64, f64)>,
}

#[derive(Default)]
struct ToolbarState {
    content: Option<(Bounds, Value)>,
    revision: u64,
    presented: bool,
}

impl ToolbarState {
    fn payload(&self) -> Value {
        json!({
            "revision": self.revision,
            "state": self.content.as_ref().map(|(_, state)| state),
        })
    }
}

impl Default for Toolbar {
    fn default() -> Self {
        Self {
            current: Mutex::new(ToolbarState::default()),
            height: Mutex::new(88.0),
            offset: Mutex::new((0.0, 0.0)),
        }
    }
}

fn rect(bounds: &Bounds, height: f64, offset: &mut (f64, f64)) -> Rect {
    // The native view includes the toolbar's 16px padding on each side. Its width
    // must follow the visible bar so horizontal dragging does not clip its controls.
    let width = bounds.width.min(1132.0);
    let height = height.min(bounds.height);
    let centered_left = (bounds.width - width) / 2.0;
    let bottom_top = bounds.height - height;
    let left = (centered_left + offset.0).clamp(0.0, bounds.width - width);
    let top = (bottom_top + offset.1).clamp(0.0, bottom_top);
    *offset = (left - centered_left, top - bottom_top);
    Rect {
        position: LogicalPosition::new(bounds.left + left, bounds.top + top).into(),
        size: LogicalSize::new(width, height).into(),
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
    let next = bounds.zip(state);
    let (present, bounds_changed, bounds, payload) = {
        let mut current = toolbar.current.lock().unwrap();
        let present = current.content.as_ref().map(|v| &v.1["accountId"])
            != next.as_ref().map(|v| &v.1["accountId"]);
        let bounds_changed = current.content.as_ref().map(|v| &v.0) != next.as_ref().map(|v| &v.0);
        let state_changed = current.content.as_ref().map(|v| &v.1) != next.as_ref().map(|v| &v.1);
        if present {
            current.revision += 1;
            current.presented = false;
        }
        current.content = next;
        let bounds = current.content.as_ref().map(|v| v.0.clone());
        let payload = (present || state_changed).then(|| current.payload());
        (present, bounds_changed, bounds, payload)
    };
    let Some(bounds) = bounds else {
        if let Some(view) = app.get_webview("toolbar") {
            crate::overlay::hide(&view).await?;
            if let Some(payload) = payload {
                // Clear menus and pointer capture while preserving the native drag offset.
                view.emit("assistant:toolbar", payload).map_err(|e| e.to_string())?;
            }
        }
        return Ok(());
    };
    if let Some(view) = app.get_webview("toolbar") {
        if present {
            crate::overlay::hide(&view).await?;
        } else if bounds_changed {
            let geometry = rect(
                &bounds,
                *toolbar.height.lock().unwrap(),
                &mut toolbar.offset.lock().unwrap(),
            );
            view.set_bounds(geometry).map_err(|e| e.to_string())?;
        }
        if let Some(payload) = payload {
            view.emit("assistant:toolbar", payload)
                .map_err(|e| e.to_string())?;
        }
    } else {
        let geometry = rect(
            &bounds,
            *toolbar.height.lock().unwrap(),
            &mut toolbar.offset.lock().unwrap(),
        );
        app.get_window("main")
            .ok_or("主窗口不存在")?
            .add_child(
                tauri::webview::WebviewBuilder::new(
                    "toolbar",
                    WebviewUrl::App("toolbar.html".into()),
                )
                .devtools(cfg!(debug_assertions))
                .transparent(true)
                .focused(false)
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                .on_navigation(|url| {
                    matches!(
                        url.host_str(),
                        Some("localhost" | "tauri.localhost" | "127.0.0.1")
                    )
                }),
                LogicalPosition::new(-10000.0, -10000.0),
                geometry.size,
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn toolbar_ready(app: AppHandle, webview: Webview) -> Result<Value, String> {
    require_toolbar(&webview)?;
    Ok(app
        .state::<Toolbar>()
        .current
        .lock()
        .unwrap()
        .payload())
}

#[tauri::command]
pub async fn toolbar_resize(app: AppHandle, webview: Webview, height: f64, revision: u64) -> Result<(), String> {
    require_toolbar(&webview)?;
    let toolbar = app.state::<Toolbar>();
    let (bounds, reveal) = {
        let current = toolbar.current.lock().unwrap();
        if current.revision != revision {
            return Ok(());
        }
        (current.content.as_ref().map(|v| v.0.clone()), !current.presented)
    };
    if let Some(bounds) = bounds {
        {
            let mut current_height = toolbar.height.lock().unwrap();
            if *current_height == height && !reveal {
                return Ok(());
            }
            *current_height = height;
        }
        let geometry = rect(&bounds, height, &mut toolbar.offset.lock().unwrap());
        let handle = app.clone();
        crate::overlay::place(&webview, geometry, reveal, move || {
            let toolbar = handle.state::<Toolbar>();
            let current = toolbar.current.lock().unwrap();
            current.revision == revision && current.content.is_some()
        }).await?;
        let mut current = toolbar.current.lock().unwrap();
        if current.revision == revision && current.content.is_some() {
            current.presented = true;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn toolbar_move(
    app: AppHandle,
    webview: Webview,
    delta_x: f64,
    delta_y: f64,
    revision: u64,
) -> Result<(), String> {
    require_toolbar(&webview)?;
    let toolbar = app.state::<Toolbar>();
    let bounds = {
        let current = toolbar.current.lock().unwrap();
        if current.revision != revision || !current.presented {
            return Ok(());
        }
        current.content.as_ref().map(|v| v.0.clone())
    };
    if let Some(bounds) = bounds {
        let height = *toolbar.height.lock().unwrap();
        let geometry = {
            let mut offset = toolbar.offset.lock().unwrap();
            let previous = *offset;
            offset.0 += delta_x;
            offset.1 += delta_y;
            let geometry = rect(&bounds, height, &mut offset);
            if *offset == previous {
                return Ok(());
            }
            geometry
        };
        let handle = app.clone();
        crate::overlay::place(&webview, geometry, false, move || {
            let toolbar = handle.state::<Toolbar>();
            let current = toolbar.current.lock().unwrap();
            current.revision == revision && current.presented && current.content.is_some()
        }).await?;
    }
    Ok(())
}

#[tauri::command]
pub fn toolbar_action(
    app: AppHandle,
    webview: Webview,
    account_id: String,
    action: Value,
    revision: u64,
) -> Result<(), String> {
    require_toolbar(&webview)?;
    {
        let toolbar = app.state::<Toolbar>();
        let current = toolbar.current.lock().unwrap();
        if current.revision != revision || !current.presented
            || current.content.as_ref().and_then(|(_, state)| state["accountId"].as_str())
                != Some(account_id.as_str())
        {
            return Ok(());
        }
    }
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
