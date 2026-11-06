use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl};

#[derive(Clone, Deserialize, Serialize)]
pub struct Bounds {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}
#[derive(Default)]
pub struct Overlay(pub Mutex<Option<(String, Bounds, Value)>>);

#[tauri::command]
pub async fn overlay_sync(
    app: AppHandle,
    webview: Webview,
    account_id: Option<String>,
    bounds: Option<Bounds>,
    task: Option<Value>,
) -> Result<(), String> {
    crate::require_main(&webview)?;
    let state = app.state::<Overlay>();
    let next = account_id
        .zip(bounds)
        .zip(task)
        .map(|((id, bounds), task)| (id, bounds, task));
    let mut current = state.0.lock().unwrap();
    let recreate = current.as_ref().map(|v| &v.0) != next.as_ref().map(|v| &v.0);
    if (recreate || next.is_none()) && app.get_webview("logs").is_some() {
        app.get_webview("logs")
            .unwrap()
            .close()
            .map_err(|e| e.to_string())?;
    }
    *current = next;
    let Some((_, bounds, task)) = current.as_ref() else {
        return Ok(());
    };
    if let Some(view) = app.get_webview("logs") {
        let size = view
            .size()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(view.window().scale_factor().map_err(|e| e.to_string())?);
        view.set_position(LogicalPosition::new(
            bounds.left + bounds.width - size.width,
            bounds.top + bounds.height - size.height,
        ))
        .map_err(|e| e.to_string())?;
        view.emit("assistant:logs", task)
            .map_err(|e| e.to_string())?;
    } else {
        let handle = app.clone();
        let builder =
            tauri::webview::WebviewBuilder::new("logs", WebviewUrl::App("overlay.html".into()))
                .transparent(true)
                .on_navigation(|url| {
                    matches!(
                        url.host_str(),
                        Some("localhost" | "tauri.localhost" | "127.0.0.1")
                    )
                })
                .on_page_load(move |_, event| {
                    if event.event() == tauri::webview::PageLoadEvent::Finished {
                        if let Some((_, _, task)) =
                            handle.state::<Overlay>().0.lock().unwrap().as_ref()
                        {
                            let _ = handle.emit_to("logs", "assistant:logs", task);
                        }
                    }
                });
        app.get_window("main")
            .ok_or("主窗口不存在")?
            .add_child(
                builder,
                LogicalPosition::new(
                    bounds.left + bounds.width - 472.0,
                    bounds.top + bounds.height - 340.0,
                ),
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
    let current = state.0.lock().unwrap();
    if let Some((_, bounds, _)) = current.as_ref() {
        webview
            .set_position(LogicalPosition::new(
                bounds.left + bounds.width - width,
                bounds.top + bounds.height - height,
            ))
            .map_err(|e| e.to_string())?;
        webview
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle, webview: Webview) -> Result<Option<Value>, String> {
    if webview.label() != "logs" {
        return Err("无权读取日志层".into());
    }
    Ok(app
        .state::<Overlay>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|v| v.2.clone()))
}
