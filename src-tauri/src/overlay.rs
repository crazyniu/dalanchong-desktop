//! AI module map
//! Purpose: render collection, invitation and browser-install progress in one native child view.
//! Entry: main uses overlay_sync; the logs WebView uses overlay_ready/resize/action.
//! Flow: retain one child WebView and present new content after its layout acknowledgement.
//! Main keeps running invitations visible across routes and dialogs with the stable
//! global-progress presentation key; browser downloads share that non-modal stack,
//! while collection content follows its account and coverage.
//! A raise request reorders an already-presented view above new account WebViews without
//! hiding it, changing its revision, or activating/focusing the window.
//! State: Overlay stores the presentation key, bounds, and discriminated task content.
//! Presentation revisions change only across hiding/key switches. Late layout and action
//! messages cannot reveal or operate on a different presentation.
//! Snapshot state under short locks before native calls; main-thread callbacks also read it.
//! Move incoming task content into state and build event payloads only when it changes;
//! geometry-only updates do not clone the retained collection log window.
//! Invariants: only the logs view may resize or forward actions; main owns task changes.
//! Size validation limits the native overlay. Invitation actions carry an account ID;
//! main routes them across platforms. Coordinate payloads with invite-progress.tsx and log-overlay.tsx.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl};

#[derive(Clone, Deserialize, Serialize, PartialEq)]
pub struct Bounds {
    pub(crate) left: f64,
    pub(crate) top: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}
pub struct Overlay {
    current: Mutex<OverlayState>,
    size: Mutex<(f64, f64)>,
}

#[derive(Default)]
struct OverlayState {
    content: Option<(String, Bounds, Value)>,
    revision: u64,
    presented: bool,
}

impl OverlayState {
    fn payload(&self) -> Value {
        json!({
            "revision": self.revision,
            "content": self.content.as_ref().map(|(_, _, task)| task),
        })
    }
}

impl Default for Overlay {
    fn default() -> Self {
        Self {
            current: Mutex::new(OverlayState::default()),
            size: Mutex::new((472.0, 340.0)),
        }
    }
}

#[tauri::command]
pub async fn overlay_sync(
    app: AppHandle,
    webview: Webview,
    account_id: Option<String>,
    bounds: Option<Bounds>,
    task: Option<Value>,
    raise: bool,
) -> Result<(), String> {
    crate::require_main(&webview)?;
    let state = app.state::<Overlay>();
    let next = account_id
        .zip(bounds)
        .zip(task)
        .map(|((id, bounds), task)| (id, bounds, task));
    // Native getters and child creation wait for the main thread, whose page-load
    // callback reads this state. Release the guard before crossing that boundary.
    let (present, bounds_changed, bounds, payload, revision, presented) = {
        let mut current = state.current.lock().unwrap();
        let present = current.content.as_ref().map(|v| &v.0) != next.as_ref().map(|v| &v.0);
        let bounds_changed = current.content.as_ref().map(|v| &v.1) != next.as_ref().map(|v| &v.1);
        let task_changed = current.content.as_ref().map(|v| &v.2) != next.as_ref().map(|v| &v.2);
        if present {
            current.revision += 1;
            current.presented = false;
        }
        current.content = next;
        let bounds = current.content.as_ref().map(|v| v.1.clone());
        let payload = (present || task_changed).then(|| current.payload());
        (present, bounds_changed, bounds, payload, current.revision, current.presented)
    };
    let Some(bounds) = bounds else {
        if let Some(view) = app.get_webview("logs") {
            hide(&view).await?;
        }
        // Retain the mounted collection card while covered, including its collapsed
        // state and scroll position. Its account/start-time key resets on a new task.
        return Ok(());
    };
    if let Some(view) = app.get_webview("logs") {
        if present {
            hide(&view).await?;
        } else if raise && presented {
            // A persistent invitation card must stay above account WebViews created
            // or restored later. Reuse its committed size without another hide/show cycle.
            let (width, height) = *state.size.lock().unwrap();
            let handle = app.clone();
            place(&view, Rect {
                position: LogicalPosition::new(
                    bounds.left + bounds.width - width,
                    bounds.top + bounds.height - height,
                ).into(),
                size: LogicalSize::new(width, height).into(),
            }, true, move || {
                let state = handle.state::<Overlay>();
                let current = state.current.lock().unwrap();
                current.revision == revision && current.presented && current.content.is_some()
            }).await?;
        } else if bounds_changed {
            let (width, height) = *state.size.lock().unwrap();
            view.set_position(LogicalPosition::new(
                bounds.left + bounds.width - width,
                bounds.top + bounds.height - height,
            ))
            .map_err(|e| e.to_string())?;
        }
        if let Some(payload) = payload {
            view.emit("assistant:logs", payload)
                .map_err(|e| e.to_string())?;
        }
    } else {
        let builder =
            tauri::webview::WebviewBuilder::new("logs", WebviewUrl::App("overlay.html".into()))
                .devtools(cfg!(debug_assertions))
                .transparent(true)
                .focused(false)
                .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
                .on_navigation(|url| {
                    matches!(
                        url.host_str(),
                        Some("localhost" | "tauri.localhost" | "127.0.0.1")
                    )
                });
        // Start offscreen at a usable layout size. The child reads the current payload
        // and acknowledges its committed layout before moving into the browser area.
        app.get_window("main")
            .ok_or("主窗口不存在")?
            .add_child(
                builder,
                LogicalPosition::new(-10000.0, -10000.0),
                LogicalSize::new(472.0, 340.0),
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn overlay_resize(
    app: AppHandle,
    webview: Webview,
    width: f64,
    height: f64,
    revision: u64,
) -> Result<(), String> {
    if webview.label() != "logs" {
        return Err("无权调整日志层".into());
    }
    if !width.is_finite()
        || !height.is_finite()
        || !(1.0..=500.0).contains(&width)
        || !(1.0..=500.0).contains(&height)
    {
        return Err("日志区域尺寸无效".into());
    }
    let state = app.state::<Overlay>();
    let (bounds, reveal) = {
        let current = state.current.lock().unwrap();
        if current.revision != revision {
            return Ok(());
        }
        (current.content.as_ref().map(|(_, bounds, _)| bounds.clone()), !current.presented)
    };
    if let Some(bounds) = bounds {
        {
            let mut size = state.size.lock().unwrap();
            if *size == (width, height) && !reveal {
                return Ok(());
            }
            *size = (width, height);
        }
        let handle = app.clone();
        place(&webview, Rect {
                position: LogicalPosition::new(
                    bounds.left + bounds.width - width,
                    bounds.top + bounds.height - height,
                ).into(),
                size: LogicalSize::new(width, height).into(),
            }, reveal, move || {
                let state = handle.state::<Overlay>();
                let current = state.current.lock().unwrap();
                current.revision == revision && current.content.is_some()
            }).await?;
        let mut current = state.current.lock().unwrap();
        if current.revision == revision && current.content.is_some() {
            current.presented = true;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle, webview: Webview) -> Result<Value, String> {
    if webview.label() != "logs" {
        return Err("无权读取日志层".into());
    }
    Ok(app
        .state::<Overlay>()
        .current
        .lock()
        .unwrap()
        .payload())
}

#[tauri::command]
pub fn overlay_action(app: AppHandle, webview: Webview, action: Value, revision: u64) -> Result<(), String> {
    if webview.label() != "logs" {
        return Err("此页面无权操作任务浮层".into());
    }
    let state = app.state::<Overlay>();
    let (inviting, browser_install) = {
        let current = state.current.lock().unwrap();
        if current.revision != revision || !current.presented {
            return Ok(());
        }
        current.content.as_ref().map(|(_, _, content)| (
            content["kind"] == "invite",
            content["kind"] == "browser-install" || content["browserInstall"].is_object(),
        )).unwrap_or((false, false))
    };
    if browser_install && action["type"] == "dismiss-browser-install" {
        // Dismissal changes presentation only; main keeps native installation alive.
        app.emit_to("main", "assistant:browser-install-action", json!({ "action": action }))
            .map_err(|e| e.to_string())?;
    } else if inviting && action["type"] == "stop" {
        // The global card forwards account-scoped intent; main owns task operations.
        app.emit_to(
            "main",
            "assistant:invite-progress-action",
            json!({ "action": action }),
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Acknowledge the actual UI-thread hide before the main WebView mounts a dialog.
pub(crate) async fn hide(view: &Webview) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let hidden = view.clone();
    view.run_on_main_thread(move || {
        let _ = sender.send(hidden.hide().map_err(|error| error.to_string()));
    }).map_err(|error| error.to_string())?;
    receiver.await.map_err(|_| "浮层隐藏已取消".to_string())?
}

/// Place a committed child layout on the UI thread. The revision predicate rejects
/// acknowledgements overtaken by a dialog or account switch before any native change.
pub(crate) async fn place(
    view: &Webview,
    geometry: Rect,
    reveal: bool,
    is_current: impl FnOnce() -> bool + Send + 'static,
) -> Result<(), String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let positioned = view.clone();
    view.with_webview(move |platform| {
        let result = (|| {
            if !is_current() {
                return Ok(());
            }
            positioned.set_bounds(geometry).map_err(|error| error.to_string())?;
            if reveal {
                show_above(&platform)?;
            }
            Ok(())
        })();
        let _ = sender.send(result);
    }).map_err(|error| error.to_string())?;
    receiver.await.map_err(|_| "浮层显示已取消".to_string())?
}

#[cfg(target_os = "macos")]
fn show_above(platform: &tauri::webview::PlatformWebview) -> Result<(), String> {
    use objc2_app_kit::{NSView, NSWindowOrderingMode};

    // SAFETY: Tauri supplies the live WKWebView on the AppKit thread; WKWebView is an
    // NSView subclass. Both references remain borrowed within this callback. AppKit
    // moves the existing sibling above its peers without detaching or recreating it.
    unsafe {
        let view = &*platform.inner().cast::<NSView>();
        let parent = view.superview().ok_or("浮层父视图不存在")?;
        parent.addSubview_positioned_relativeTo(view, NSWindowOrderingMode::Above, None);
        view.setHidden(false);
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn show_above(platform: &tauri::webview::PlatformWebview) -> Result<(), String> {
    use windows::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW,
    };

    // SAFETY: the UI-thread controller owns Wry's child container HWND (not the main
    // application HWND). Reorder that child among siblings without changing geometry,
    // keyboard focus, or the top-level window's activation/topmost state.
    unsafe {
        let controller = platform.controller();
        let mut container = HWND::default();
        controller.ParentWindow(&mut container).map_err(|error| error.to_string())?;
        controller.SetIsVisible(true).map_err(|error| error.to_string())?;
        if SetWindowPos(
            container.0, HWND_TOP, 0, 0, 0, 0,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW,
        ) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn show_above(_platform: &tauri::webview::PlatformWebview) -> Result<(), String> {
    Err("当前系统不支持原生浮层".into())
}
