//! AI module map
//! Purpose: download and install the app-owned Chromium browser on first shop open.
//! Entry: chrome.rs calls executable on a blocking worker outside its lifecycle lock;
//! require_launch_allowed prevents installation/launch during shutdown or updates.
//! Flow: embedded engine.json selects the fixed official platform asset URL/version/hash.
//! Rebrand a completed matching local engine when only branding changed. Otherwise
//! download into a private staging directory, verify SHA-256, then let
//! chrome_runtime_install.rs prepare the independent browser before atomic publication.
//! State: INSTALLATION serializes installers without blocking browser close operations.
//! Each installed version owns browser-runtime/<version>-<sha256>-<branding>; profiles belong to
//! chrome.rs and are never read, migrated or deleted by this module.
//! Progress is optional UI feedback; a closed channel does not interrupt installation.
//! Invariants: development and release use the same on-demand installation path.
//! No build-time browser, user's Chrome installation, retry or fingerprint override.

use std::{collections::HashMap, fs, io::Write, path::PathBuf, sync::Mutex, time::{Duration, Instant}};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{ipc::Channel, AppHandle, Manager};

#[path = "chrome_runtime_install.rs"]
mod install;

static INSTALLATION: Mutex<()> = Mutex::new(());

#[cfg(target_os = "macos")]
pub(crate) const MAC_APP_BUNDLE: &str = "大懒虫浏览器.app";

#[derive(Clone, Serialize)]
pub struct BrowserInstallProgress {
    pub stage: String,
    pub downloaded: u64,
    pub total: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Engine {
    bundle_identifier: String,
    display_name: String,
    downloads: HashMap<String, Download>,
}

#[derive(Deserialize)]
struct Download {
    version: String,
    url: String,
    sha256: String,
}

pub fn require_launch_allowed(app: &AppHandle) -> Result<(), String> {
    if crate::is_shutting_down() {
        return Err("程序正在退出".into());
    }
    if app.state::<crate::update::Updates>().is_installing() {
        return Err("正在更新，请稍后打开店铺".into());
    }
    Ok(())
}

fn report(channel: Option<&Channel<BrowserInstallProgress>>, stage: &str, downloaded: u64, total: Option<u64>) {
    if let Some(channel) = channel {
        let _ = channel.send(BrowserInstallProgress { stage: stage.into(), downloaded, total });
    }
}

fn binary(directory: &std::path::Path) -> PathBuf {
    #[cfg(target_os = "macos")]
    return directory.join(MAC_APP_BUNDLE).join("Contents/MacOS/Chromium");
    #[cfg(target_os = "windows")]
    return directory.join("WindowsBrowser/chrome.exe");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    directory.join("unsupported-browser-platform")
}

// Only completed engine directories from our known version/hash layouts are
// considered. Branding changes never trigger a different-version fallback or a
// search outside the browser-runtime resource root.
fn installed_engine(root: &std::path::Path, engine_key: &str) -> Result<Option<PathBuf>, String> {
    let branded_prefix = format!("{engine_key}-");
    let mut candidates = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| format!("读取已安装浏览器失败：{e}"))? {
        let entry = entry.map_err(|e| format!("读取已安装浏览器失败：{e}"))?;
        if !entry.file_type().map_err(|e| format!("读取已安装浏览器失败：{e}"))?.is_dir() { continue; }
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue; };
        let known_version = name == engine_key || name.strip_prefix(branded_prefix.as_str())
            .is_some_and(|brand| brand.len() == 16 && brand.bytes().all(|byte| byte.is_ascii_hexdigit()));
        if !known_version { continue; }
        let directory = entry.path();
        #[cfg(target_os = "macos")]
        let complete = [MAC_APP_BUNDLE, "DalanchongBrowser.app"].iter()
            .any(|bundle| directory.join(bundle).join("Contents/MacOS/Chromium").is_file());
        #[cfg(not(target_os = "macos"))]
        let complete = binary(&directory).is_file();
        if complete { candidates.push(directory); }
    }
    candidates.sort();
    Ok(candidates.into_iter().next())
}

pub fn executable(app: &AppHandle, on_progress: Option<&Channel<BrowserInstallProgress>>) -> Result<PathBuf, String> {
    let engine: Engine = serde_json::from_str(include_str!("../../browser-runtime/engine.json"))
        .map_err(|e| format!("读取专用浏览器配置失败：{e}"))?;
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let platform = "darwin/arm64";
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    let platform = "win32/x64";
    #[cfg(not(any(all(target_os = "macos", target_arch = "aarch64"), all(target_os = "windows", target_arch = "x86_64"))))]
    let platform = "unsupported";
    let download = engine.downloads.get(platform).ok_or("当前系统不支持专用浏览器")?;
    // A logo or application-identity change prepares a new bundle instead of
    // silently reusing old branded files or rewriting a running browser.
    let mut branding = Sha256::new();
    branding.update(engine.bundle_identifier.as_bytes());
    branding.update(engine.display_name.as_bytes());
    #[cfg(target_os = "macos")]
    {
        branding.update(MAC_APP_BUNDLE.as_bytes());
        branding.update(include_bytes!("../../assets/icons/app.icns"));
    }
    #[cfg(target_os = "windows")]
    branding.update(include_bytes!("../../assets/icons/app.ico"));
    let branding = format!("{:x}", branding.finalize());
    let root = crate::data_dir(app).join("browser-runtime");
    let engine_key = format!("{}-{}", download.version, download.sha256);
    let directory = root.join(format!("{engine_key}-{}", &branding[..16]));
    let path = binary(&directory);
    if path.is_file() { return Ok(path); }
    let _installation = INSTALLATION.lock().unwrap();
    require_launch_allowed(app)?;
    if path.is_file() { return Ok(path); }
    fs::create_dir_all(&root).map_err(|e| format!("创建浏览器安装目录失败：{e}"))?;
    let existing = installed_engine(&root, &engine_key)?;
    let staging = root.join(format!(".install-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|e| format!("创建浏览器临时目录失败：{e}"))?;
    let result = (|| {
        if let Some(source) = existing {
            report(on_progress, "installing", 0, None);
            let prepared = staging.join("engine");
            fs::create_dir(&prepared).map_err(|e| format!("创建浏览器资源目录失败：{e}"))?;
            install::reuse(&source, &prepared, &staging, &engine, download)?;
            if !binary(&prepared).is_file() { return Err("专用浏览器安装资源缺少主程序".into()); }
            fs::rename(&prepared, &directory).map_err(|e| format!("安装专用浏览器失败：{e}"))?;
            report(on_progress, "ready", 0, None);
            return Ok(path);
        }
        let archive = staging.join(if cfg!(target_os = "macos") { "browser.dmg" } else { "browser.zip" });
        report(on_progress, "downloading", 0, None);
        let (downloaded, total, hash) = tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(30))
                .read_timeout(Duration::from_secs(60))
                .build().map_err(|e| format!("创建浏览器下载连接失败：{e}"))?;
            let mut response = client.get(&download.url).send().await
                .and_then(reqwest::Response::error_for_status)
                .map_err(|e| format!("下载专用浏览器失败：{e}"))?;
            let total = response.content_length();
            let mut file = fs::File::create(&archive).map_err(|e| format!("保存浏览器下载失败：{e}"))?;
            let mut downloaded = 0;
            let mut hash = Sha256::new();
            let mut last = Instant::now();
            report(on_progress, "downloading", downloaded, total);
            while let Some(chunk) = response.chunk().await.map_err(|e| format!("下载专用浏览器失败：{e}"))? {
                file.write_all(&chunk).map_err(|e| format!("保存浏览器下载失败：{e}"))?;
                hash.update(&chunk);
                downloaded += chunk.len() as u64;
                if last.elapsed() >= Duration::from_millis(250) {
                    require_launch_allowed(app)?;
                    report(on_progress, "downloading", downloaded, total);
                    last = Instant::now();
                }
            }
            file.flush().map_err(|e| format!("保存浏览器下载失败：{e}"))?;
            Ok::<_, String>((downloaded, total, format!("{:x}", hash.finalize())))
        })?;
        report(on_progress, "verifying", downloaded, total);
        if hash != download.sha256 { return Err("专用浏览器下载校验失败，文件 SHA-256 不一致".into()); }
        require_launch_allowed(app)?;
        report(on_progress, "installing", downloaded, total);
        let prepared = staging.join("engine");
        fs::create_dir(&prepared).map_err(|e| format!("创建浏览器资源目录失败：{e}"))?;
        install::prepare(&archive, &prepared, &staging, &engine, download)?;
        if !binary(&prepared).is_file() { return Err("专用浏览器安装资源缺少主程序".into()); }
        fs::rename(&prepared, &directory).map_err(|e| format!("安装专用浏览器失败：{e}"))?;
        report(on_progress, "ready", downloaded, total);
        Ok(path)
    })();
    // The unique staging directory contains only this installation's resources.
    // Existing engine versions and account data are never part of cleanup.
    let _ = fs::remove_dir_all(&staging);
    result
}
