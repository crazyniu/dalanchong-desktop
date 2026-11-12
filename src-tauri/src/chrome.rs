//! AI module map
//! Purpose: manage isolated accounts in the app-owned, independently branded Chromium browser.
//! Entry: chrome_accounts/save_account/open/remove_account serve main; close_all serves
//! shutdown and updater installation. Invitation WebViews and their sessions are untouched.
//! Flow: workbench.json maps UUIDs to fixed numbers, names, default window percentages and last-opened timestamps.
//! chrome_runtime.rs prepares the packaged browser executable. Each shop starts it
//! with an isolated chromium-profiles directory; previous chrome-profiles stay untouched.
//! No fingerprint-modification parameters are passed to the engine.
//! Each shop can browse any web platform: first launch opens about:blank, later cold
//! launches restore the previous session and reload its HTTP(S) tabs once after
//! extension initialization. Reusing a running browser never reloads its pages.
//! Opening restores a normal window and applies
//! the shop's configured size before activation, independent of saved session bounds.
//! Restore/create the window before querying extensions: a macOS process can outlive
//! its last window and unload its profile while the browser CDP endpoint stays alive.
//! On macOS, chrome_dock.rs draws the shop number into its in-memory Dock image;
//! the shop's browser CDP socket applies it on cold launch and reuse without modifying Chrome.
//! Each UUID owns one chromium-profiles directory containing Chromium-managed cookies,
//! storage, tabs and bookmarks;
//! disk-cache-dir explicitly keeps the browser cache inside that same account directory.
//! Cold launches seed native bookmarks once; default-bookmarks-initialized.json prevents
//! restoring defaults the user later deletes. The video home bookmark and pinned
//! extension icon are ensured on every cold launch. Running profiles are not rewritten.
//! The personal Chrome installation, data directory and previous browser data remain untouched.
//! Account profiles use the dedicated engine's own keychain, network and media configuration.
//! State: operation serializes file/process changes; children owns launcher handles,
//! not necessarily Chrome's surviving process after a native relaunch/handoff.
//! Browser downloads run outside operation so shutdown can close existing windows;
//! chrome_runtime owns its separate installation lock and sends progress to main.
//! Launch eligibility is rechecked after taking operation. There is no runtime download.
//! The browser-level Extensions API loads the video extension from its fixed path when absent.
//! Extension UI/logic is maintained in browser-extension/; Chrome keeps its
//! storage and downloads isolated by account profile. Shop identity is synced to extension
//! storage through its worker session for the fixed page label, including when an
//! existing window is activated.
//! Suspended workers are started through an existing page.
//! Renaming a shop with no open page only saves its record; the next open syncs its label.
//! CDP stays on loopback for browser lifecycle and extension loading, never
//! for exporting credentials or claiming login success from cookies. Profiles survive exit.
//! Cold launches use an explicit nonzero debugging port. .chrome-debug.json owns
//! its port, browser PID and Chrome-discovered random browser path per profile.
//! On macOS chrome_process.rs resolves the profile's actual running Chrome from
//! SingletonLock and its exact argv before connecting or deciding to cold-start.
//! Legacy Chrome-written DevToolsActivePort remains readable only when no owned
//! endpoint exists, so already-running port-zero shops can be reused and closed.
//! Invariants: main caller and the latest native license result guard user operations; cleanup works after
//! expiry. Launch only the prepared dedicated browser with an app-owned data directory.

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::ErrorKind,
    net::{SocketAddr, TcpListener, TcpStream},
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
    #[serde(default = "default_window_scale")]
    window_scale: u32,
    last_opened_at: Option<String>,
}

fn default_window_scale() -> u32 { 80 }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    id: Option<Uuid>,
    name: String,
    window_scale: u32,
}

#[derive(Serialize)]
struct WindowBounds {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

// Chrome uses logical screen coordinates. Size and center the window within the
// main app's current monitor work area, leaving the menu bar and Dock/taskbar free.
fn window_bounds(monitor: &tauri::window::Monitor, percent: u32) -> WindowBounds {
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let available_width = area.size.width as f64 / scale;
    let available_height = area.size.height as f64 / scale;
    let width = (available_width * percent as f64 / 100.0).round() as i32;
    let height = (available_height * percent as f64 / 100.0).round() as i32;
    WindowBounds {
        left: (area.position.x as f64 / scale + (available_width - width as f64) / 2.0).round() as i32,
        top: (area.position.y as f64 / scale + (available_height - height as f64) / 2.0).round() as i32,
        width,
        height,
    }
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
    data_dir(app).join("chromium-profiles").join(id.to_string())
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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DebugEndpoint {
    port: u16,
    pid: u32,
    browser_path: Option<String>,
}

// macOS Chrome may hand startup to an existing/relaunched process. Recover only
// the process whose exact user-data-dir owns this profile, never an arbitrary port.
pub(crate) fn connect(directory: &Path) -> Result<Option<WebSocket<TcpStream>>, String> {
    let owned = directory.join(".chrome-debug.json");
    let saved: Option<DebugEndpoint> = match fs::read(&owned) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes).map_err(|e| e.to_string())?),
        Err(e) if e.kind() == ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    #[cfg(target_os = "macos")]
    let saved = match crate::chrome_process::running(directory)? {
        Some((_, 0)) => return Ok(None),
        Some((pid, port)) => Some(match saved {
            Some(endpoint) if endpoint.pid == pid && endpoint.port == port => endpoint,
            _ => DebugEndpoint { pid, port, browser_path: None },
        }),
        None => saved,
    };
    if let Some(mut endpoint) = saved {
        if endpoint.port == 0 || endpoint.pid == 0 || endpoint.pid > i32::MAX as u32 {
            return Err("店铺浏览器连接记录无效".into());
        }
        if !process_alive(endpoint.pid)? { return Ok(None); }
        let discovered = endpoint.browser_path.is_none();
        let path = match &endpoint.browser_path {
            Some(path) => path.clone(),
            None => match discover_browser_path(endpoint.port)? {
                Some(path) => path,
                None => return Ok(None),
            },
        };
        let Some(mut socket) = connect_endpoint(endpoint.port, &path)? else { return Ok(None); };
        let info = call(&mut socket, "SystemInfo.getProcessInfo", json!({}))?;
        if !info["processInfo"].as_array().is_some_and(|items| items.iter().any(|item| {
            item["type"] == "browser" && item["id"].as_f64() == Some(endpoint.pid as f64)
        })) {
            return Err("店铺浏览器进程与连接记录不匹配".into());
        }
        if discovered {
            endpoint.browser_path = Some(path);
            storage::write_json(&owned, &endpoint).map_err(|e| e.to_string())?;
        }
        return Ok(Some(socket));
    }
    let content = match fs::read_to_string(directory.join("DevToolsActivePort")) {
        Ok(content) => content,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut lines = content.lines();
    let port: u16 = lines.next().ok_or("浏览器尚未就绪")?
        .parse().map_err(|_| "浏览器端口无效")?;
    let path = lines.next().ok_or("浏览器尚未就绪")?;
    connect_endpoint(port, path)
}

fn discover_browser_path(port: u16) -> Result<Option<String>, String> {
    use std::error::Error as _;

    let version: Value = match tauri::async_runtime::block_on(async {
        let client = reqwest::Client::builder().no_proxy()
            .redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(2))
            .build().map_err(|e| e.to_string())?;
        let response = match client.get(format!("http://127.0.0.1:{port}/json/version")).send().await {
            Ok(response) => response,
            Err(error) => {
                let mut cause = error.source();
                while let Some(source) = cause {
                    if source.downcast_ref::<std::io::Error>()
                        .is_some_and(|e| e.kind() == ErrorKind::ConnectionRefused) { return Ok(None); }
                    cause = source.source();
                }
                return Err(format!("读取店铺浏览器连接失败：{error}"));
            }
        };
        if !response.status().is_success() {
            return Err(format!("读取店铺浏览器连接失败：HTTP {}", response.status()));
        }
        let value = response.json::<Value>().await.map_err(|e| e.to_string())?;
        Ok::<_, String>(Some(value))
    })? {
        Some(version) => version,
        None => return Ok(None),
    };
    let address = url::Url::parse(version["webSocketDebuggerUrl"].as_str().ok_or("浏览器未提供连接地址")?)
        .map_err(|_| "浏览器连接地址无效")?;
    if address.scheme() != "ws" || address.host_str() != Some("127.0.0.1")
        || address.port() != Some(port) || !address.username().is_empty() || address.password().is_some()
        || address.query().is_some() || address.fragment().is_some()
    {
        return Err("浏览器连接地址不属于当前店铺端口".into());
    }
    Ok(Some(address.path().to_owned()))
}

fn connect_endpoint(port: u16, path: &str) -> Result<Option<WebSocket<TcpStream>>, String> {
    if !path.starts_with("/devtools/browser/") || path.len() == "/devtools/browser/".len()
        || path.contains(['?', '#'])
    {
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
    call_session(socket, None, method, params)
}

fn call_session(socket: &mut WebSocket<TcpStream>, session: Option<&str>, method: &str, params: Value) -> Result<Value, String> {
    let mut request = json!({"id":1,"method":method,"params":params});
    if let Some(session) = session { request["sessionId"] = json!(session); }
    socket.send(Message::Text(request.to_string().into()))
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

fn activate(socket: &mut WebSocket<TcpStream>, bounds: &WindowBounds) -> Result<(), String> {
    let id = match page_target(socket)? {
        Some(id) => id,
        None => call(socket, "Target.createTarget", json!({"url": "about:blank"}))?["targetId"]
            .as_str().ok_or("打开网页失败")?.to_owned(),
    };
    let window = call(socket, "Browser.getWindowForTarget", json!({"targetId":id}))?;
    if window["bounds"]["windowState"] != "normal" {
        call(socket, "Browser.setWindowBounds", json!({"windowId":window["windowId"],"bounds":{"windowState":"normal"}}))?;
        // Native fullscreen transitions are asynchronous. Wait for normal state before
        // setting dimensions; Chrome rejects size changes while still fullscreen.
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let state = call(socket, "Browser.getWindowBounds", json!({"windowId":window["windowId"]}))?;
            if state["bounds"]["windowState"] == "normal" { break; }
            if Instant::now() >= deadline { return Err("浏览器尚未退出全屏或最大化状态，请稍后再打开".into()); }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    call(socket, "Browser.setWindowBounds", json!({
        "windowId": window["windowId"],
        "bounds": bounds
    }))?;
    call(socket, "Target.activateTarget", json!({"targetId":id}))?;
    Ok(())
}

fn reload_restored_pages(socket: &mut WebSocket<TcpStream>) -> Result<(), String> {
    let targets = call(socket, "Target.getTargets", json!({}))?;
    let pages = targets["targetInfos"].as_array().ok_or("读取恢复的标签页失败")?;
    for page in pages {
        if page["type"] != "page" || !page["url"].as_str()
            .is_some_and(|url| url.starts_with("https://") || url.starts_with("http://"))
        {
            continue;
        }
        let attached = call(socket, "Target.attachToTarget", json!({"targetId":page["targetId"],"flatten":true}))?;
        let session = attached["sessionId"].as_str().ok_or("连接恢复的标签页失败")?;
        // Reload only once during cold restoration, after the extension is ready.
        // Detach even when reloading fails; the user keeps ownership of the tab.
        let reloaded = call_session(socket, Some(session), "Page.reload", json!({}));
        let detached = call(socket, "Target.detachFromTarget", json!({"sessionId":session}));
        reloaded.map_err(|e| format!("刷新恢复的标签页失败：{e}"))?;
        detached?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_dock_tile(socket: &mut WebSocket<TcpStream>, account: &ChromeAccount) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    // Keep the number inside the image so its visibility does not depend on the
    // system badge. This command affects only this shop process's in-memory tile.
    let image = crate::chrome_dock::icon(account.number)?;
    call(socket, "Browser.setDockTile", json!({
        "badgeLabel": "",
        "image": STANDARD.encode(image)
    })).map_err(|e| format!("设置店铺浏览器图标失败：{e}"))?;
    Ok(())
}

fn open(app: &AppHandle, account: &ChromeAccount, bounds: &WindowBounds, binary: &Path) -> Result<(), String> {
    let directory = profile(app, account.id);
    if let Some(mut socket) = connect(&directory)? {
        // A live CDP endpoint does not guarantee a loaded profile after the last
        // window closes. Creating its page reloads the profile needed by Extensions.
        activate(&mut socket, bounds)?;
        #[cfg(target_os = "macos")]
        set_dock_tile(&mut socket, account)?;
        load_video_extension(&mut socket, &browser_extension::prepare(app)?, &directory, account)?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    if crate::chrome_process::running(&directory)?.is_some() {
        return Err("店铺浏览器正在运行，连接尚未就绪，请稍后再打开".into());
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
    let profile_name = format!("大懒虫 · {}", account.name);
    if first_launch {
        storage::write_json(&preferences, &json!({
            "profile":{"name":profile_name},
            "bookmark_bar":{"show_on_all_tabs":true},
            "session":{"restore_on_startup":1}
        })).map_err(|e| e.to_string())?;
    } else {
        let mut values: Value = serde_json::from_slice(&fs::read(&preferences)
            .map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if values["profile"]["name"] != profile_name {
            values["profile"]["name"] = json!(profile_name);
            storage::write_json(&preferences, &values).map_err(|e| e.to_string())?;
        }
    }
    let video_home_url = browser_extension::pin(&directory, &extension)?;
    prepare_bookmarks(&directory, &video_home_url)?;
    for name in ["DevToolsActivePort", ".chrome-debug.json"] {
        let file = directory.join(name);
        if file.exists() { fs::remove_file(file).map_err(|e| e.to_string())?; }
    }
    // Release the reserved loopback port immediately before Chrome binds it.
    // Unlike port zero, a specific port does not enable Chromium's automation flag.
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    let mut command = Command::new(binary);
    command.arg(format!("--user-data-dir={}", directory.display()))
        .arg(format!("--disk-cache-dir={}", directory.join("Cache").display()))
        .arg(format!("--window-size={},{}", bounds.width, bounds.height))
        .arg(format!("--window-position={},{}", bounds.left, bounds.top))
        .arg(format!("--remote-debugging-port={port}"))
        .args(["--no-first-run", "--no-default-browser-check", "--disable-background-mode",
            "--remote-debugging-address=127.0.0.1"])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if !first_launch {
        command.arg("--restore-last-session");
    } else {
        command.arg("about:blank");
    }
    let mut child = command.spawn().map_err(|e| format!("启动浏览器失败：{e}"))?;
    let endpoint = DebugEndpoint { port, pid: child.id(), browser_path: None };
    if let Err(error) = storage::write_json(&directory.join(".chrome-debug.json"), &endpoint) {
        // Only this just-spawned Child is ours to stop if its endpoint cannot be saved.
        let _ = child.kill();
        let _ = child.wait();
        return Err(format!("保存店铺浏览器连接失败：{error}"));
    }
    let mut children = state.children.lock().unwrap();
    children.retain(|_, child| !matches!(child.try_wait(), Ok(Some(_))));
    children.insert(account.id, child);
    drop(children);
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        // Reap an exited launcher without treating it as the browser's exit.
        // Chrome's profile owner and CDP readiness determine startup completion.
        state.children.lock().unwrap().get_mut(&account.id).unwrap()
            .try_wait().map_err(|e| e.to_string())?;
        if let Some(mut socket) = connect(&directory)? {
            // The browser endpoint becomes ready before Chrome creates/restores its
            // first page. Wait for that page instead of creating a duplicate launch tab.
            if page_target(&mut socket)?.is_some() {
                activate(&mut socket, bounds)?;
                #[cfg(target_os = "macos")]
                set_dock_tile(&mut socket, account)?;
                load_video_extension(&mut socket, &extension, &directory, account)?;
                if !first_launch { reload_restored_pages(&mut socket)?; }
                return Ok(());
            }
        }
        if Instant::now() >= deadline {
            return Err("浏览器启动超时，请稍后重新打开".into());
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn load_video_extension(socket: &mut WebSocket<TcpStream>, extension: &Path, profile: &Path, account: &ChromeAccount) -> Result<(), String> {
    let id = browser_extension::extension_id(extension)?;
    let fingerprint = browser_extension::fingerprint(extension)?;
    let marker = profile.join(".video-extension-fingerprint");
    let installed = call(socket, "Extensions.getExtensions", json!({}))
        .map_err(|e| format!("读取视频插件失败：{e}"))?;
    let current = installed["extensions"].as_array().is_some_and(|items| {
        items.iter().any(|item| item["id"] == id && item["enabled"] == true)
    }) && fs::read_to_string(&marker).ok().as_deref() == Some(fingerprint.as_str());
    if !current {
        // Reload changed resources without clearing the account's extension storage.
        call(socket, "Extensions.loadUnpacked", json!({"path":extension}))
            .map_err(|e| format!("加载视频插件失败：{e}"))?;
        let loaded = call(socket, "Extensions.getExtensions", json!({}))?;
        if !loaded["extensions"].as_array().is_some_and(|items| {
            items.iter().any(|item| item["id"] == id && item["enabled"] == true)
        }) {
            return Err("视频插件未启用，请关闭该店铺的全部浏览器窗口后重新打开".into());
        }
    }
    sync_extension_state(socket, &id, account).map_err(|e| format!("同步插件状态失败：{e}"))?;
    if !current { fs::write(marker, fingerprint).map_err(|e| e.to_string())?; }
    Ok(())
}

fn sync_extension_state(socket: &mut WebSocket<TcpStream>, extension_id: &str, account: &ChromeAccount) -> Result<(), String> {
    // Storage access belongs to the extension renderer, not the browser target.
    // Use an existing page's ServiceWorker domain to wake a suspended background;
    // opening a management tab would interrupt the user's current workflow.
    let page = page_target(socket)?.ok_or("浏览器页面尚未就绪")?;
    let attached = call(socket, "Target.attachToTarget", json!({"targetId":page,"flatten":true}))?;
    let page_session = attached["sessionId"].as_str().ok_or("连接浏览器页面失败")?;
    let result: Result<(), String> = (|| {
        call_session(socket, Some(page_session), "ServiceWorker.enable", json!({}))?;
        let scope = format!("chrome-extension://{extension_id}/");
        call_session(socket, Some(page_session), "ServiceWorker.startWorker", json!({"scopeURL":scope}))?;
        let deadline = Instant::now() + Duration::from_secs(5);
        let worker = loop {
            let targets = call(socket, "Target.getTargets", json!({}))?;
            let target = targets["targetInfos"].as_array().and_then(|items| {
                items.iter().find(|item| item["type"] == "service_worker"
                    && item["url"].as_str().is_some_and(|url| url.starts_with(&scope)))
                    .and_then(|item| item["targetId"].as_str()).map(str::to_owned)
            });
            if let Some(target) = target { break target; }
            if Instant::now() >= deadline { return Err("视频插件后台启动超时".into()); }
            std::thread::sleep(Duration::from_millis(100));
        };
        let attached = call(socket, "Target.attachToTarget", json!({"targetId":worker,"flatten":true}))?;
        let worker_session = attached["sessionId"].as_str().ok_or("连接视频插件后台失败")?;
        let stored = call_session(socket, Some(worker_session), "Extensions.setStorageItems", json!({
            "id": extension_id,
            "storageArea": "local",
            "values": {
                "shopIdentity": {"number": account.number, "name": account.name}
            }
        }));
        let detached = call(socket, "Target.detachFromTarget", json!({"sessionId":worker_session}));
        stored?;
        detached?;
        Ok(())
    })();
    let detached = call(socket, "Target.detachFromTarget", json!({"sessionId":page_session}));
    result?;
    detached?;
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
    #[cfg(target_os = "macos")]
    if browser_pid.is_none() && crate::chrome_process::running(&directory)?.is_some() {
        return Err("店铺浏览器仍在运行，但连接尚未就绪，无法关闭".into());
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
        #[cfg(target_os = "macos")]
        let process_running = process_running || crate::chrome_process::running(&directory)?.is_some();
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
        if ![60, 70, 80, 90].contains(&input.window_scale) {
            return Err("请选择浏览器默认尺寸".into());
        }
        let mut entries = accounts(app)?;
        let account = if let Some(id) = input.id {
            let entry = entries.iter_mut().find(|entry| entry.id == id).ok_or("店铺不存在")?;
            entry.name = name.into();
            entry.window_scale = input.window_scale;
            entry.clone()
        } else {
            let entry = ChromeAccount { id: Uuid::new_v4(),
                number: entries.iter().map(|entry| entry.number).max().unwrap_or(0) + 1,
                name: name.into(), window_scale: input.window_scale, last_opened_at: None };
            entries.push(entry.clone());
            entry
        };
        if let Some(mut socket) = connect(&profile(app, account.id))? {
            // With all windows closed there is no visible label to update, and
            // the profile may be unloaded. Opening later syncs this saved identity.
            if page_target(&mut socket)?.is_some() {
                load_video_extension(&mut socket, &browser_extension::prepare(app)?, &profile(app, account.id), &account)?;
            }
        }
        save(app, &entries)?;
        Ok(account)
    }).await
}

// Tauri decodes Channel through CommandArg directly; wrapping it in Option
// would require a Deserialize implementation that Channel does not provide.
#[tauri::command]
pub async fn chrome_open(app: AppHandle, webview: Webview, id: Uuid,
    on_progress: tauri::ipc::Channel<chrome_runtime::BrowserInstallProgress>,
) -> Result<ChromeAccount, String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    // Resolve UI-owned monitor data before taking the lifecycle lock. Dock exit
    // waits for that lock on the main thread, so its owner must never await UI work.
    let monitor = app.get_window("main").ok_or("主窗口不存在")?
        .current_monitor().map_err(|e| e.to_string())?.ok_or("未找到当前屏幕")?;
    execute(app.clone(), move |app| {
        chrome_runtime::require_launch_allowed(app)?;
        if !accounts(app)?.iter().any(|account| account.id == id) {
            return Err("店铺不存在".into());
        }
        Ok(())
    }).await?;
    let installer_app = app.clone();
    let binary = tauri::async_runtime::spawn_blocking(move || {
        chrome_runtime::executable(&installer_app, Some(&on_progress))
    }).await.map_err(|e| e.to_string())??;
    execute(app, move |app| {
        license::require_valid(app)?;
        chrome_runtime::require_launch_allowed(app)?;
        let mut entries = accounts(app)?;
        let account = entries.iter_mut().find(|entry| entry.id == id).ok_or("店铺不存在")?;
        open(app, account, &window_bounds(&monitor, account.window_scale), &binary)?;
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

#[cfg(all(test, target_os = "macos"))]
#[path = "chrome_tests.rs"]
mod tests;
