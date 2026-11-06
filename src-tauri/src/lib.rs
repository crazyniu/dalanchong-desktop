mod browser;
mod cookies;
mod license;
mod overlay;
mod storage;
mod toolbar;
mod update;

use std::{collections::HashSet, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Manager, Webview, WebviewUrl, WebviewWindowBuilder};

#[derive(Default)]
pub struct Tasks(pub Mutex<HashSet<String>>);

pub fn require_main(webview: &Webview) -> Result<(), String> {
    if webview.label() == "main" {
        Ok(())
    } else {
        Err("此页面无权操作本机数据".into())
    }
}

pub fn profile_dir(app: &AppHandle) -> PathBuf {
    std::env::var_os("ASSISTANT_TEST_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            app.path()
                .config_dir()
                .expect("系统应用目录不可用")
                .join("电商助手")
        })
}

pub fn data_dir(app: &AppHandle) -> PathBuf {
    profile_dir(app).join("assistant-data")
}

pub fn task_running(app: &AppHandle, account_id: &str) -> bool {
    app.state::<Tasks>().0.lock().unwrap().contains(account_id)
}

#[tauri::command]
async fn set_task_state(
    app: AppHandle,
    webview: Webview,
    account_id: String,
    running: bool,
) -> Result<(), String> {
    require_main(&webview)?;
    if running {
        license::require_valid(&app).await?;
    }
    let tasks = app.state::<Tasks>();
    let mut tasks = tasks.0.lock().unwrap();
    if running {
        tasks.insert(account_id.clone());
    } else {
        tasks.remove(&account_id);
    }
    drop(tasks);
    browser::set_busy(&app, &account_id, running)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Tasks::default())
        .manage(cookies::CookieStore::default())
        .manage(overlay::Overlay::default())
        .manage(toolbar::Toolbar::default())
        .manage(browser::BrowserState::default())
        .manage(storage::Storage::default())
        .setup(|app| {
            std::fs::create_dir_all(data_dir(app.handle()))?;
            app.manage(license::License::new(app.handle())?);
            app.manage(update::Updates::new(&app.package_info().version.to_string()));
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .on_navigation(|url| matches!(url.scheme(), "tauri" | "http" | "https") && matches!(url.host_str(), Some("localhost" | "tauri.localhost" | "127.0.0.1")))
                .title("大懒虫").inner_size(1440.0, 960.0).min_inner_size(1024.0, 700.0);
            #[cfg(debug_assertions)]
            let builder = builder.initialization_script("window.addEventListener('error', e => window.__TAURI_INTERNALS__.invoke('diagnostic_append', {entry:{level:'error',message:e.message,source:e.filename,line:e.lineno}})); window.addEventListener('unhandledrejection', e => window.__TAURI_INTERNALS__.invoke('diagnostic_append',{entry:{level:'error',message:String(e.reason)}}));");
            #[cfg(target_os = "macos")]
            let builder = builder.data_store_identifier(*uuid::Uuid::new_v5(
                &uuid::Uuid::NAMESPACE_URL, profile_dir(app.handle()).to_string_lossy().as_bytes()
            ).as_bytes());
            #[cfg(not(target_os = "macos"))]
            let builder = builder.data_directory(profile_dir(app.handle()).join("tauri-ui"));
            let window=builder.build()?;
            let close_app=app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api,.. } = event {
                    api.prevent_close();
                    shutdown(&close_app);
                }
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { update::check(&handle).await; });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            license::license_state, license::license_verify, license::license_activate,
            storage::runtime_load, storage::runtime_save, storage::diagnostic_append, storage::diagnostic_export, storage::diagnostic_clear,
            set_task_state, overlay::overlay_ready, overlay::overlay_sync, overlay::overlay_resize, overlay::overlay_action,
            toolbar::toolbar_ready, toolbar::toolbar_sync, toolbar::toolbar_resize, toolbar::toolbar_action,
            browser::browser_prepare, browser::browser_show, browser::browser_hide, browser::browser_navigate,
            browser::browser_login, browser::browser_finish_login, browser::browser_remove, browser::platform_eval, browser::platform_result, browser::platform_observe,
            update::update_state, update::update_check, update::update_download, update::update_install,
        ])
        .build(tauri::generate_context!())
        .expect("大懒虫启动失败")
        .run(|app,event| {
            if let tauri::RunEvent::ExitRequested { api,code:None,.. } = event {
                api.prevent_exit(); shutdown(app);
            }
        });
}

fn shutdown(app: &AppHandle) {
    static CLOSING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if CLOSING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    app.state::<Tasks>().0.lock().unwrap().clear();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = browser::flush_sessions(&app).await {
            cookies::report(&app, "", &error);
        }
        let storage = app.state::<storage::Storage>();
        let _saved = storage.0.lock().await;
        app.exit(0);
    });
}
