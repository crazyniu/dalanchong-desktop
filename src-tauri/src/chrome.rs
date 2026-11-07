//! AI module map
//! Purpose: manage isolated accounts in the user's installed Google Chrome Stable.
//! Entry: chrome_accounts/save_account/open/remove_account serve main; close_all serves
//! shutdown and updater installation. Invitation WebViews and their sessions are untouched.
//! Flow: workbench.json maps UUIDs to fixed numbers, names and last-opened timestamps.
//! chrome_runtime.rs locates Chrome. Web content uses native browser settings and codecs.
//! Each shop can browse any web platform: first launch opens about:blank, later cold
//! launches restore the previous session, and existing windows are activated.
//! Each UUID owns one chrome-profiles directory containing Chrome-managed cookies,
//! storage, tabs and bookmarks;
//! disk-cache-dir explicitly keeps the browser cache inside that same account directory.
//! Cold launches seed native bookmarks once; default-bookmarks-initialized.json prevents
//! restoring defaults the user later deletes. The video home bookmark and pinned
//! extension icon are ensured on every cold launch. Running profiles are not rewritten.
//! The personal Chrome data directory and previous browser data remain untouched.
//! Account profiles use Chrome's native keychain, network and media configuration.
//! State: operation serializes file/process changes; children owns spawned process handles.
//! Launch eligibility is rechecked after taking operation. There is no runtime download.
//! The browser-level Extensions API loads the video extension from its fixed path when absent.
//! Extension UI/logic is maintained in browser-extension/; Chrome keeps its
//! storage and downloads isolated by account profile. Existing windows are only activated.
//! CDP stays on loopback for browser lifecycle and extension loading, never
//! for exporting credentials or claiming login success from cookies. Profiles survive exit.
//! Invariants: main caller and the latest native license result guard user operations; cleanup works after
//! expiry. Launch the installed official browser with an explicit app-owned data directory.

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::ErrorKind,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Webview};
use tungstenite::{client, Message, WebSocket};
use uuid::Uuid;

use crate::{browser_extension, chrome_runtime, data_dir, license, require_main, storage};

#[derive(Default)]
pub struct Chrome {
    operation: tokio::sync::Mutex<()>,
    children: Mutex<HashMap<Uuid, Child>>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromeAccount {
    id: Uuid,
    #[serde(default)]
    number: u32,
    name: String,
    last_opened_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    id: Option<Uuid>,
    name: String,
}

fn accounts(app: &AppHandle) -> Result<Vec<ChromeAccount>, String> {
    let mut entries: Vec<ChromeAccount> = match fs::read(data_dir(app).join("workbench.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string())?,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    let mut number = entries.iter().map(|entry| entry.number).max().unwrap_or(0);
    let mut changed = false;
    for entry in &mut entries {
        if entry.number == 0 {
            number += 1;
            entry.number = number;
            changed = true;
        }
    }
    if changed { save(app, &entries)?; }
    Ok(entries)
}

fn save(app: &AppHandle, entries: &[ChromeAccount]) -> Result<(), String> {
    storage::write_json(&data_dir(app).join("workbench.json"), entries)
        .map_err(|e| e.to_string())
}

fn profile(app: &AppHandle, id: Uuid) -> PathBuf {
    data_dir(app).join("chrome-profiles").join(id.to_string())
}

const DEFAULT_BOOKMARKS: [(&str, &str); 7] = [
    ("抖店", "https://fxg.jinritemai.com/"),
    ("快手小店", "https://s.kwaixiaodian.com/"),
    ("巨量百应", "https://buyin.jinritemai.com/"),
    ("巨量千川", "https://qianchuan.jinritemai.com/"),
    ("磁力金牛", "https://niu.e.kuaishou.com/"),
    ("抖音创作平台", "https://creator.douyin.com/"),
    ("快手创作平台", "https://cp.kuaishou.com/"),
];

fn bookmark_folder(id: &str, name: &str, now: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "type": "folder",
        "children": [],
        "date_added": now,
        "date_modified": now,
        "date_last_used": "0"
    })
}

fn collect_bookmarks(node: &Value, last_id: &mut i64, urls: &mut HashSet<String>) {
    if let Some(id) = node["id"].as_str().and_then(|id| id.parse::<i64>().ok()) {
        *last_id = (*last_id).max(id);
    }
    if let Some(address) = node["url"].as_str() {
        // Compare canonical URLs without changing any user-owned bookmark fields.
        let address = url::Url::parse(address)
            .map(|url| url.to_string()).unwrap_or_else(|_| address.to_owned());
        urls.insert(address);
    }
    if let Some(children) = node["children"].as_array() {
        for child in children {
            collect_bookmarks(child, last_id, urls);
        }
    }
}

// Called only after the CDP and managed-child checks establish a cold launch.
// The marker applies only to the seven platform defaults. Every account always receives
// the video home entry, including accounts initialized before the extension was added.
fn prepare_bookmarks(directory: &Path, video_home_url: &str) -> Result<(), String> {
    let marker = directory.join("default-bookmarks-initialized.json");
    let seed_defaults = !marker.exists();
    let path = directory.join("Default/Bookmarks");
    // Chromium stores dates as decimal microseconds since the Windows epoch (1601).
    let now = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000
        + 11_644_473_600_000_000).to_string();
    let mut bookmarks: Value = match fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|e| format!("读取浏览器收藏失败：{e}"))?,
        Err(e) if e.kind() == ErrorKind::NotFound => json!({
            "version": 1,
            "roots": {
                "bookmark_bar": bookmark_folder("1", "Bookmarks bar", &now),
                "other": bookmark_folder("2", "Other bookmarks", &now),
                "synced": bookmark_folder("3", "Mobile bookmarks", &now)
            }
        }),
        Err(e) => return Err(format!("读取浏览器收藏失败：{e}")),
    };
    if bookmarks["version"] != 1 {
        return Err("浏览器收藏格式不支持".into());
    }
    let roots = bookmarks["roots"].as_object().ok_or("浏览器收藏格式不正确")?;
    let mut last_id = 3;
    let mut urls = HashSet::new();
    for root in roots.values() {
        collect_bookmarks(root, &mut last_id, &mut urls);
    }
    let bar = bookmarks["roots"].get_mut("bookmark_bar")
        .and_then(Value::as_object_mut).ok_or("浏览器收藏栏格式不正确")?;
    let children = bar.get_mut("children").and_then(Value::as_array_mut)
        .ok_or("浏览器收藏栏格式不正确")?;
    let mut entries = if seed_defaults { DEFAULT_BOOKMARKS.to_vec() } else { vec![] };
    entries.push(("视频下载", video_home_url));
    let previous_video_url = video_home_url.replace("#videos", "#settings");
    let mut changed = false;
    for (name, address) in entries {
        if address == video_home_url {
            // Prefer the current home entry, then update our named settings entry in place.
            // Only name/URL change; retain the bookmark's ID, GUID and other metadata.
            let index = children.iter().position(|item| item["url"] == address)
                .or_else(|| children.iter().position(|item| {
                    item["name"] == name && item["url"] == previous_video_url
                }));
            if let Some(index) = index {
                let bookmark = &mut children[index];
                if bookmark["name"] != name {
                    bookmark["name"] = json!(name);
                    changed = true;
                }
                if bookmark["url"] != address {
                    bookmark["url"] = json!(address);
                    changed = true;
                }
                continue;
            }
        } else if urls.contains(address) {
            continue;
        }
        last_id = last_id.checked_add(1).ok_or("浏览器收藏编号已用尽")?;
        children.push(json!({
            "id": last_id.to_string(),
            "guid": Uuid::new_v4().to_string(),
            "name": name,
            "type": "url",
            "url": address,
            "date_added": now,
            "date_last_used": "0"
        }));
        changed = true;
    }
    if changed {
        bar.insert("date_modified".into(), json!(now));
        // Current Chromium decodes without these output-only checksums and rewrites
        // them on save. Preserve existing IDs, GUIDs, sync metadata and other fields.
        let object = bookmarks.as_object_mut().ok_or("浏览器收藏格式不正确")?;
        object.remove("checksum");
        object.remove("checksum_sha256");
        storage::write_json(&path, &bookmarks)
            .map_err(|e| format!("保存浏览器收藏失败：{e}"))?;
    }
    if seed_defaults {
        storage::write_json(&marker, &json!({"version": 1})).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Only a Chrome-written port/path inside this account's directory can select a target.
// Connection refusal means a previous browser exited; other connection failures surface.
pub(crate) fn connect(directory: &Path) -> Result<Option<WebSocket<TcpStream>>, String> {
    let content = match fs::read_to_string(directory.join("DevToolsActivePort")) {
        Ok(content) => content,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut lines = content.lines();
    let port: u16 = lines.next().ok_or("浏览器尚未就绪")?
        .parse().map_err(|_| "浏览器端口无效")?;
    let path = lines.next().ok_or("浏览器尚未就绪")?;
    if !path.starts_with("/devtools/browser/") {
        return Err("浏览器连接地址无效".into());
    }
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let stream = match TcpStream::connect_timeout(&address, Duration::from_secs(2)) {
        Ok(stream) => stream,
        Err(e) if e.kind() == ErrorKind::ConnectionRefused => return Ok(None),
        Err(e) => return Err(format!("连接浏览器失败：{e}")),
    };
    stream.set_read_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
    let (socket, _) = client(format!("ws://127.0.0.1:{port}{path}"), stream)
        .map_err(|_| "连接浏览器失败，请关闭该店铺的浏览器后重试")?;
    Ok(Some(socket))
}

fn call(socket: &mut WebSocket<TcpStream>, method: &str, params: Value) -> Result<Value, String> {
    socket.send(Message::Text(json!({"id":1,"method":method,"params":params}).to_string().into()))
        .map_err(|e| e.to_string())?;
    loop {
        let message = socket.read().map_err(|e| e.to_string())?;
        if let Message::Text(text) = message {
            let mut reply: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            if reply["id"] != 1 { continue; }
            if let Some(error) = reply.get("error") {
                return Err(error["message"].as_str().unwrap_or("浏览器操作失败").into());
            }
            return Ok(reply["result"].take());
        }
    }
}

fn page_target(socket: &mut WebSocket<TcpStream>) -> Result<Option<String>, String> {
    let targets = call(socket, "Target.getTargets", json!({}))?;
    Ok(targets["targetInfos"].as_array().and_then(|items| {
        items.iter().find(|item| item["type"] == "page")
            .and_then(|item| item["targetId"].as_str())
            .map(str::to_owned)
    }))
}

fn activate(socket: &mut WebSocket<TcpStream>) -> Result<(), String> {
    let id = match page_target(socket)? {
        Some(id) => id,
        None => call(socket, "Target.createTarget", json!({"url": "about:blank"}))?["targetId"]
            .as_str().ok_or("打开网页失败")?.to_owned(),
    };
    let window = call(socket, "Browser.getWindowForTarget", json!({"targetId":id}))?;
    if window["bounds"]["windowState"] == "minimized" {
        call(socket, "Browser.setWindowBounds", json!({"windowId":window["windowId"],"bounds":{"windowState":"normal"}}))?;
    }
    call(socket, "Target.activateTarget", json!({"targetId":id}))?;
    Ok(())
}

fn open(app: &AppHandle, binary: &Path, account: &ChromeAccount) -> Result<(), String> {
    let directory = profile(app, account.id);
    if let Some(mut socket) = connect(&directory)? {
        load_video_extension(&mut socket, &browser_extension::prepare(app)?)?;
        return activate(&mut socket);
    }
    let state = app.state::<Chrome>();
    {
        let mut children = state.children.lock().unwrap();
        if let Some(child) = children.get_mut(&account.id) {
            // A timed-out startup can still own this profile. Preserve that process
            // handle and its port file until it becomes ready or actually exits.
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                return Err("浏览器正在启动或关闭，请稍后重试".into());
            }
            children.remove(&account.id);
        }
    }
    let extension = browser_extension::prepare(app)?;
    fs::create_dir_all(directory.join("Default")).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let preferences = directory.join("Default/Preferences");
    let first_launch = !preferences.exists();
    if first_launch {
        storage::write_json(&preferences, &json!({
            "profile":{"name":account.name},
            "bookmark_bar":{"show_on_all_tabs":true},
            "session":{"restore_on_startup":1}
        })).map_err(|e| e.to_string())?;
    } else {
        let mut values: Value = serde_json::from_slice(&fs::read(&preferences)
            .map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if values["profile"]["name"] != account.name {
            values["profile"]["name"] = json!(account.name);
            storage::write_json(&preferences, &values).map_err(|e| e.to_string())?;
        }
    }
    let video_home_url = browser_extension::pin(&directory, &extension)?;
    prepare_bookmarks(&directory, &video_home_url)?;
    let port_file = directory.join("DevToolsActivePort");
    if port_file.exists() { fs::remove_file(port_file).map_err(|e| e.to_string())?; }
    let mut command = Command::new(binary);
    command.arg(format!("--user-data-dir={}", directory.display()))
        .arg(format!("--disk-cache-dir={}", directory.join("Cache").display()))
        .args(["--no-first-run", "--no-default-browser-check", "--disable-background-mode",
            "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if !first_launch {
        command.arg("--restore-last-session");
    } else {
        command.arg("about:blank");
    }
    let child = command.spawn().map_err(|e| format!("启动浏览器失败：{e}"))?;
    let mut children = state.children.lock().unwrap();
    children.retain(|_, child| !matches!(child.try_wait(), Ok(Some(_))));
    children.insert(account.id, child);
    drop(children);
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(mut socket) = connect(&directory)? {
            // The browser endpoint becomes ready before Chrome creates/restores its
            // first page. Wait for that page instead of creating a duplicate launch tab.
            if page_target(&mut socket)?.is_some() {
                load_video_extension(&mut socket, &extension)?;
                return activate(&mut socket);
            }
        }
        if state.children.lock().unwrap().get_mut(&account.id).unwrap()
            .try_wait().map_err(|e| e.to_string())?.is_some()
        {
            return Err("浏览器未能启动，请关闭该店铺的旧窗口后重试".into());
        }
        if Instant::now() >= deadline {
            return Err("浏览器启动超时，请稍后重新打开".into());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn load_video_extension(socket: &mut WebSocket<TcpStream>, extension: &Path) -> Result<(), String> {
    let id = browser_extension::extension_id(extension)?;
    let installed = call(socket, "Extensions.getExtensions", json!({}))
        .map_err(|e| format!("读取视频插件失败：{e}"))?;
    if installed["extensions"].as_array().is_some_and(|items| {
        items.iter().any(|item| item["id"] == id && item["enabled"] == true)
    }) {
        return Ok(());
    }
    // Chrome marks CDP loads as session installations. Load the same absolute path
    // on each cold start; never uninstall the extension or clear its account storage.
    call(socket, "Extensions.loadUnpacked", json!({"path":extension}))
        .map_err(|e| format!("加载视频插件失败：{e}"))?;
    Ok(())
}

fn close(app: &AppHandle, id: Uuid) -> Result<(), String> {
    let directory = profile(app, id);
    let mut browser_pid = None;
    if let Some(mut socket) = connect(&directory)? {
        let info = call(&mut socket, "SystemInfo.getProcessInfo", json!({}))?;
        browser_pid = info["processInfo"].as_array().and_then(|items| {
            items.iter().find(|item| item["type"] == "browser")
                .and_then(|item| item["id"].as_f64())
                .filter(|pid| *pid >= 1.0 && *pid <= i32::MAX as f64)
                .map(|pid| pid as u32)
        });
        if browser_pid.is_none() { return Err("无法确认浏览器进程，请先关闭窗口再重试".into()); }
        // Chrome may close the socket before acknowledging Browser.close. The actual
        // process exit below is authoritative, not that acknowledgement. A restarted
        // app can reconnect to Chrome without owning its Child, so CDP supplies its PID.
        let _ = call(&mut socket, "Browser.close", json!({}));
    }
    let state = app.state::<Chrome>();
    let mut children = state.children.lock().unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let child_running = match children.get_mut(&id) {
            Some(child) => child.try_wait().map_err(|e| e.to_string())?.is_none(),
            None => false,
        };
        let process_running = match browser_pid {
            Some(pid) => process_alive(pid)?,
            None => false,
        };
        if !child_running && !process_running { break; }
        if Instant::now() >= deadline {
            return Err("浏览器正在保存登录信息，请关闭窗口后重试".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    children.remove(&id);
    Ok(())
}

#[cfg(unix)]
fn process_alive(pid: u32) -> Result<bool, String> {
    unsafe extern "C" { fn kill(pid: i32, signal: i32) -> i32; }
    // SAFETY: PID comes from the local browser process. Signal zero only probes
    // existence/permission; it never terminates or otherwise signals the browser.
    if unsafe { kill(pid as i32, 0) } == 0 { return Ok(true); }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(3) { Ok(false) } // POSIX ESRCH: process has exited.
    else { Err(error.to_string()) }
}

#[cfg(windows)]
fn process_alive(pid: u32) -> Result<bool, String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_INVALID_PARAMETER, STILL_ACTIVE},
        System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };
    // SAFETY: request a non-inheritable query-only handle for the browser PID. The
    // stack output pointer is valid, and each acquired handle is closed on every path.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            let error = std::io::Error::last_os_error();
            return if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER as i32) {
                Ok(false)
            } else { Err(error.to_string()) };
        }
        let mut code = 0;
        let result = if GetExitCodeProcess(handle, &mut code) == 0 {
            Err(std::io::Error::last_os_error().to_string())
        } else { Ok(code == STILL_ACTIVE as u32) };
        CloseHandle(handle);
        result
    }
}

async fn execute<T: Send + 'static>(
    app: AppHandle,
    action: impl FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let state = app.state::<Chrome>();
    let _operation = state.operation.lock().await;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || action(&handle)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn chrome_accounts(app: AppHandle, webview: Webview) -> Result<Vec<ChromeAccount>, String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    execute(app, accounts).await
}

#[tauri::command]
pub async fn chrome_save_account(app: AppHandle, webview: Webview, input: AccountInput) -> Result<ChromeAccount, String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    execute(app, move |app| {
        let name = input.name.trim();
        if name.is_empty() { return Err("请输入店铺名称".into()); }
        let mut entries = accounts(app)?;
        let account = if let Some(id) = input.id {
            let entry = entries.iter_mut().find(|entry| entry.id == id).ok_or("店铺不存在")?;
            entry.name = name.into();
            entry.clone()
        } else {
            let entry = ChromeAccount { id: Uuid::new_v4(),
                number: entries.iter().map(|entry| entry.number).max().unwrap_or(0) + 1,
                name: name.into(), last_opened_at: None };
            entries.push(entry.clone());
            entry
        };
        save(app, &entries)?;
        Ok(account)
    }).await
}

#[tauri::command]
pub async fn chrome_open(app: AppHandle, webview: Webview, id: Uuid) -> Result<ChromeAccount, String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    execute(app, move |app| {
        license::require_valid(app)?;
        chrome_runtime::require_launch_allowed(app)?;
        let binary = chrome_runtime::executable(app)?;
        let mut entries = accounts(app)?;
        let account = entries.iter_mut().find(|entry| entry.id == id).ok_or("店铺不存在")?;
        open(app, &binary, account)?;
        account.last_opened_at = Some(time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339).map_err(|e| e.to_string())?);
        let account = account.clone();
        save(app, &entries)?;
        Ok(account)
    }).await
}

#[tauri::command]
pub async fn chrome_remove_account(app: AppHandle, webview: Webview, id: Uuid) -> Result<(), String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    execute(app, move |app| {
        let mut entries = accounts(app)?;
        if !entries.iter().any(|entry| entry.id == id) { return Err("店铺不存在".into()); }
        close(app, id)?;
        let directory = profile(app, id);
        if directory.exists() { fs::remove_dir_all(directory).map_err(|e| e.to_string())?; }
        entries.retain(|entry| entry.id != id);
        save(app, &entries)?;
        Ok(())
    }).await
}

pub async fn close_all(app: &AppHandle) -> Result<(), String> {
    execute(app.clone(), |app| {
        let mut errors = Vec::new();
        for account in accounts(app)? {
            if let Err(error) = close(app, account.id) {
                errors.push(format!("{}：{error}", account.name));
            }
        }
        if errors.is_empty() { Ok(()) } else { Err(errors.join("；")) }
    }).await
}
