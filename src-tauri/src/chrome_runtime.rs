//! AI module map
//! Purpose: locate the user's installed Google Chrome Stable without downloading a runtime.
//! Entry: chrome_open calls executable and require_launch_allowed inside its operation lock.
//! State: no browser cache or settings; Chrome owns its installation and updates.
//! Invariants: use only standard Stable installation paths. Account data is supplied
//! separately by chrome.rs; the user's personal Chrome profile is never selected.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn require_launch_allowed(app: &AppHandle) -> Result<(), String> {
    if crate::is_shutting_down() {
        return Err("程序正在退出".into());
    }
    if app.state::<crate::update::Updates>().is_installing() {
        return Err("正在更新，请稍后打开店铺".into());
    }
    Ok(())
}

pub fn executable(_app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    let paths = [
        PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        _app.path().home_dir().map_err(|e| e.to_string())?
            .join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    ];
    #[cfg(target_os = "windows")]
    let paths = ["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"]
        .into_iter()
        .filter_map(std::env::var_os)
        .map(|root| PathBuf::from(root).join("Google/Chrome/Application/chrome.exe"))
        .collect::<Vec<_>>();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let paths: [PathBuf; 0] = [];

    paths.into_iter().find(|path| path.is_file())
        .ok_or_else(|| "未找到 Google Chrome，请先安装正式版 Chrome".into())
}
