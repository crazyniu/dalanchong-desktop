//! AI module map
//! Purpose: own account WebViews and mediate communication with untrusted platform pages.
//! Entry: browser_* commands manage views; platform_eval dispatches page operations;
//! platform_result resolves pending calls; platform_observe forwards recognized captures;
//! platform_route invalidates the list capture when the platform SPA changes URL.
//! browser_history traverses the account WebView's own session history without a mirror.
//! browser_login can navigate the selected account workspace for inline login; callers
//! that omit in_workspace retain the separate account login window.
//! browser_open_external opens platform HTTPS links in the OS default browser; it does
//! not access account sessions, navigate WebViews, or interrupt running tasks.
//! browser_snapshot captures the workspace view into memory for a modal backdrop;
//! browser_snapshot.rs owns the native image APIs without reading the screen or disk.
//! Flow: an Account selects an invitation platform and session storage; prepare installs
//! page-bridge.js before navigation. Login and workspace views share a Chrome UA
//! configured at creation for both requests and navigator.userAgent.
//! The page interaction mask follows collection state, including document reloads;
//! invitation tasks remain registered for native checks without masking the page.
//! Events reach runtime.mjs through main, never
//! through direct access to local persistence. Chromium video tools are owned separately.
//! Large observed responses serialize directly from their sanitized fields without cloning
//! the body into an intermediate Value tree. Platform result and observation commands
//! decode payloads on the async runtime instead of the native UI dispatch thread.
//! Source and route checks share one native URL read per callback.
//! State: BrowserInner tracks accounts, caller labels, pending one-shot channels, and
//! latest document/route/sequence observations, plus visible workspace geometry to avoid
//! repeated native layout work. operations serializes view lifecycle changes.
//! Invariants: cookie-store IDs include the data root, unlike hardware license IDs.
//! Validate caller/source and authorization before dispatch; pending replies belong to
//! one WebView. A timed-out send has unknown outcome. Do not hold lifecycle locks while
//! waiting for page replies; preserve request ordering and credential redaction.

use std::{collections::HashMap, sync::Mutex, time::Duration};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
    window::WindowBuilder,
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Webview, WebviewUrl,
};
use tokio::sync::oneshot;
use url::Url;
use uuid::Uuid;

use crate::{data_dir, license, require_main, task_collecting, task_running};

const MAX_BODY: usize = 2 * 1024 * 1024;

// Chrome 157 is the stable milestone checked on 2026-11-07. Its reduced UA uses
// zero minor/build/patch numbers and frozen desktop OS tokens, including on ARM Macs.
const CHROME_UA_VERSION: &str = "157.0.0.0";
#[cfg(target_os = "macos")]
const CHROME_UA_PLATFORM: &str = "Macintosh; Intel Mac OS X 10_15_7";
#[cfg(target_os = "windows")]
const CHROME_UA_PLATFORM: &str = "Windows NT 10.0; Win64; x64";

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Kuaishou,
    Douyin,
}

impl Platform {
    fn origin(self) -> &'static str {
        match self {
            Self::Kuaishou => "https://cps.kwaixiaodian.com",
            Self::Douyin => "https://buyin.jinritemai.com",
        }
    }

    fn workspace_url(self) -> &'static str {
        match self {
            Self::Kuaishou => "https://cps.kwaixiaodian.com/zone/daren-match/peer-reference",
            Self::Douyin => "https://buyin.jinritemai.com/dashboard/servicehall/daren-square",
        }
    }

    fn login_url(self) -> &'static str {
        match self {
            Self::Kuaishou => "https://cps.kwaixiaodian.com/",
            Self::Douyin => "https://buyin.jinritemai.com/dashboard",
        }
    }

    fn kind(self, path: &str) -> Option<&'static str> {
        match (self, path) {
            (Self::Kuaishou, "/gateway/distribute/match/common/orchestration/execute")
            | (Self::Kuaishou, "/gateway/distribute/pc/common/promoter/list")
            | (Self::Kuaishou, "/distribute/pc/seller/promoter/list")
            | (Self::Kuaishou, "/distribute/pc/seller/promoter/search/list")
            | (Self::Kuaishou, "/gateway/distribute/platform/reco/promoter")
            | (Self::Kuaishou, "/gateway/distribute/platform/promoter/ranking/query")
            | (Self::Douyin, "/square_pc_api/square/search_feed_author")
            | (Self::Douyin, "/square_pc_api/similar_kol/list")
            | (Self::Douyin, "/square_pc_api/prd_2_kol/list")
            | (Self::Douyin, "/square_pc_api/recommend/crowd_pack_rec_author")
            | (Self::Douyin, "/square_pc_api/selection_square_clue/list")
            | (Self::Douyin, "/square_pc_api/peer/shopPeerList")
            | (Self::Douyin, "/square_pc_api/peer/shopCollectList")
            | (Self::Douyin, "/square_pc_api/rank/author/list") => Some("list"),
            (Self::Kuaishou, "/distribute/pc/seller/invite/contact")
            | (Self::Douyin, "/connection/pc/im/shop_contact_rights_info") => Some("quota"),
            (Self::Kuaishou, "/gateway/distribute/match/user/basic/login/info")
            | (Self::Douyin, "/index/getUser") => Some("account"),
            _ => None,
        }
    }

    fn supports_list(self, page: &Url, path: &str, body: &Value) -> bool {
        match (self, page.path(), path) {
            (
                Self::Kuaishou,
                "/zone/daren-match/daren-square-pro",
                "/distribute/pc/seller/promoter/search/list",
            ) => body["sceneCode"] == "ps_seller_search_promoter_list",
            (
                Self::Kuaishou,
                "/zone/daren-match/daren-square-pro",
                "/gateway/distribute/platform/reco/promoter",
            ) => matches!(
                body["sceneCode"].as_str(),
                Some(
                    "ps_reco_promoter_by_select_item"
                        | "ps_reco_promoter_by_select_promoter"
                        | "ps_reco_promoter_by_seller_channel"
                        | "ps_reco_promoter_by_relation_sameseller"
                        | "ps_reco_promoter_data_raise_up"
                )
            ),
            (
                Self::Kuaishou,
                "/zone/daren-match/peer-reference",
                "/gateway/distribute/match/common/orchestration/execute",
            ) => body["scene"] == "distribute_peer_seller_list",
            (
                Self::Kuaishou,
                "/zone/daren-match/peer-reference",
                "/gateway/distribute/pc/common/promoter/list",
            ) => body["sceneCode"] == "ps_seller_coop_promoter_list",
            (
                Self::Kuaishou,
                "/zone/daren-match/daren-square-pro",
                "/distribute/pc/seller/promoter/list",
            )
            | (
                Self::Kuaishou,
                "/zone-cps/promoter-rank-list",
                "/gateway/distribute/platform/promoter/ranking/query",
            )
            | (
                Self::Douyin,
                "/dashboard/servicehall/daren-square",
                "/square_pc_api/square/search_feed_author"
                | "/square_pc_api/similar_kol/list"
                | "/square_pc_api/prd_2_kol/list"
                | "/square_pc_api/recommend/crowd_pack_rec_author",
            )
            | (
                Self::Douyin,
                "/dashboard/servicehall/clue-daren",
                "/square_pc_api/selection_square_clue/list",
            )
            | (
                Self::Douyin,
                "/dashboard/servicehall/peer-reference",
                "/square_pc_api/peer/shopPeerList",
            )
            | (
                Self::Douyin,
                "/dashboard/servicehall/peer-reference",
                "/square_pc_api/peer/shopCollectList",
            )
            | (
                Self::Douyin,
                "/dashboard/ranklist/daren",
                "/square_pc_api/rank/author/list",
            ) => true,
            _ => false,
        }
    }
}

#[derive(Clone, Deserialize)]
pub struct Account {
    id: String,
    platform: Platform,
    name: Option<String>,
}

impl Account {
    fn url(&self) -> &'static str {
        self.platform.workspace_url()
    }
}

impl Account {
    fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.id.len() > 128 || self.id.chars().any(char::is_control) {
            return Err("账号 ID 无效".into());
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, PartialEq)]
pub struct Bounds {
    left: f64,
    top: f64,
    width: f64,
    height: f64,
}

#[derive(Clone)]
struct Source {
    account_id: String,
    platform: Platform,
    workspace: bool,
}

// A reply resolves exactly one native request and must come from its original view label.
struct Pending {
    source: String,
    sender: oneshot::Sender<Result<Value, String>>,
}

// Route revisions prevent an A -> B -> A navigation from reviving A's old requests.
// The native page-load event removes this state when the document changes.
struct PageRoute {
    document_id: String,
    revision: u64,
}

// Document and route identity bind completions to the list that is still visible;
// order compares accepted observations across views without trusting page clocks.
struct Observation {
    document_id: String,
    route_revision: u64,
    sequence: u64,
    order: u64,
}

#[derive(Default)]
struct BrowserInner {
    accounts: HashMap<String, Account>,
    sources: HashMap<String, Source>,
    pending: HashMap<String, Pending>,
    routes: HashMap<String, PageRoute>,
    latest: HashMap<(String, String), Observation>,
    order: u64,
    restored: std::collections::HashSet<String>,
    workspace_bounds: HashMap<String, Bounds>,
    visible_workspace: Option<String>,
}

#[derive(Default)]
pub struct BrowserState {
    // Serialize creation/removal, bounds changes, and snapshots; page eval remains independent.
    operations: tokio::sync::Mutex<()>,
    inner: Mutex<BrowserInner>,
}

fn store_id(app: &AppHandle, account: &Account) -> Uuid {
    // Include the data root so an isolated ASSISTANT_TEST_DATA cannot open a real
    // account's WKWebsiteDataStore. UUID v5 is stable across application restarts.
    Uuid::new_v5(
        &Uuid::NAMESPACE_URL,
        format!(
            "dalanchong\n{}\n{}\n{}",
            data_dir(app).display(),
            account.platform.origin(),
            account.id
        )
        .as_bytes(),
    )
}

fn view_label(app: &AppHandle, account: &Account, workspace: bool) -> String {
    format!(
        "{}-{}",
        if workspace { "platform" } else { "login" },
        store_id(app, account).simple()
    )
}

fn account_for(app: &AppHandle, id: &str) -> Result<Account, String> {
    app.state::<BrowserState>()
        .inner
        .lock()
        .unwrap()
        .accounts
        .get(id)
        .cloned()
        .ok_or_else(|| "账号网页尚未准备".into())
}

fn caller_source(app: &AppHandle, webview: &Webview) -> Result<(Source, Url), String> {
    let source = app
        .state::<BrowserState>()
        .inner
        .lock()
        .unwrap()
        .sources
        .get(webview.label())
        .cloned()
        .ok_or("此网页不能调用平台回传接口")?;
    let url = webview.url().map_err(|e| e.to_string())?;
    if !source_allows(&source, &url) {
        return Err("平台回传来源无效".into());
    }
    Ok((source, url))
}

fn source_allows(source: &Source, url: &Url) -> bool {
    url.origin().ascii_serialization() == source.platform.origin()
}

fn emit(app: &AppHandle, source: &Source, label: &str, mut event: Value) {
    event["accountId"] = json!(source.account_id);
    event["source"] = json!(label);
    event["workspace"] = json!(source.workspace);
    // Platform pages never receive other accounts' responses or local UI events.
    let _ = app.emit_to("main", "assistant:browser", event);
}

fn cancel_pending(app: &AppHandle, label: &str) {
    let state = app.state::<BrowserState>();
    let mut inner = state.inner.lock().unwrap();
    let ids: Vec<_> = inner
        .pending
        .iter()
        .filter(|(_, pending)| pending.source == label)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        let pending = inner.pending.remove(&id).unwrap();
        let _ = pending
            .sender
            .send(Err("平台页面已离开，执行结果未知".into()));
    }
    inner.latest.retain(|(source, _), _| source != label);
    inner.routes.remove(label);
}

pub fn set_busy(app: &AppHandle, account_id: &str, collecting: bool) -> Result<(), String> {
    let labels: Vec<_> = app
        .state::<BrowserState>()
        .inner
        .lock()
        .unwrap()
        .sources
        .iter()
        .filter(|(_, source)| source.account_id == account_id)
        .map(|(label, _)| label.clone())
        .collect();
    for label in labels {
        if let Some(view) = app.get_webview(&label) {
            view.eval(format!("window.__DALANCHONG_BRIDGE__?.setBusy({collecting})"))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn builder(app: &AppHandle, account: &Account, workspace: bool) -> WebviewBuilder<tauri::Wry> {
    let label = view_label(app, account, workspace);
    let source = Source {
        account_id: account.id.clone(),
        platform: account.platform,
        workspace,
    };
    let script = include_str!("page-bridge.js").replace(
        "__DALANCHONG_PLATFORM__",
        &serde_json::to_string(&account.platform).unwrap(),
    );
    let popup_app = app.clone();
    let popup_label = label.clone();
    let load_source = source.clone();
    let builder = WebviewBuilder::new(&label, WebviewUrl::External("about:blank".parse().unwrap()))
        .user_agent(&format!(
            "Mozilla/5.0 ({CHROME_UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{CHROME_UA_VERSION} Safari/537.36"
        ))
        .devtools(cfg!(debug_assertions))
        .initialization_script(script)
        .disable_drag_drop_handler()
        .focused(false)
        .on_navigation(|url| url.scheme() == "https" || url.as_str() == "about:blank")
        .on_new_window(move |url, _features| {
            // Match the previous login browser: target=_blank stays in its
            // originating WebView, retaining the account store and bridge.
            if url.scheme() == "https" {
                let app = popup_app.clone();
                let label = popup_label.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(view) = app.get_webview(&label) {
                        if let Err(error) = view.navigate(url) {
                            let source = app
                                .state::<BrowserState>()
                                .inner
                                .lock()
                                .unwrap()
                                .sources
                                .get(&label)
                                .cloned();
                            if let Some(source) = source {
                                emit(
                                    &app,
                                    &source,
                                    &label,
                                    json!({"type":"error", "error":error.to_string()}),
                                );
                            }
                        }
                    }
                });
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |view, payload| {
            if payload.url().scheme() != "https" {
                return;
            }
            let (event, url) = match payload.event() {
                PageLoadEvent::Started => {
                    // WKWebView also calls on_navigation for iframe navigation.
                    // Only replacing the main document invalidates its requests.
                    cancel_pending(view.app_handle(), view.label());
                    ("navigation", payload.url().clone())
                }
                PageLoadEvent::Finished => {
                    let collecting = task_collecting(view.app_handle(), &load_source.account_id);
                    let _ = view.eval(format!("window.__DALANCHONG_BRIDGE__?.setBusy({collecting})"));
                    // The platform may change its SPA route before the document
                    // finishes loading. Keep readiness bound to the visible URL.
                    let url = match view.url() {
                        Ok(url) => url,
                        Err(error) => {
                            emit(
                                view.app_handle(),
                                &load_source,
                                view.label(),
                                json!({"type":"error", "error":error.to_string()}),
                            );
                            return;
                        }
                    };
                    ("ready", url)
                },
            };
            emit(
                view.app_handle(),
                &load_source,
                view.label(),
                json!({
                    "type": event,
                    "url": clean_url(url),
                }),
            );
        });
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(*store_id(app, account).as_bytes());
    #[cfg(not(target_os = "macos"))]
    let builder = builder.data_directory(
        data_dir(app)
            .join("webview-accounts")
            .join(store_id(app, account).simple().to_string()),
    );
    builder
}

fn register(app: &AppHandle, account: &Account, workspace: bool) {
    let state = app.state::<BrowserState>();
    let mut inner = state.inner.lock().unwrap();
    inner.accounts.insert(account.id.clone(), account.clone());
    inner.sources.insert(
        view_label(app, account, workspace),
        Source {
            account_id: account.id.clone(),
            platform: account.platform,
            workspace,
            },
    );
}

fn prepare(app: &AppHandle, account: &Account) -> Result<Webview, String> {
    account.validate()?;
    if let Ok(previous) = account_for(app, &account.id) {
        if previous.platform != account.platform {
            return Err("账号平台不能改变".into());
        }
    }
    let label = view_label(app, account, true);
    if let Some(view) = app.get_webview(&label) {
        return Ok(view);
    }
    register(app, account, true);
    let main = app.get_window("main").ok_or("主窗口不存在")?;
    let result = main.add_child(
        builder(app, account, true),
        LogicalPosition::new(-10000.0, -10000.0),
        LogicalSize::new(1.0, 1.0),
    );
    let view = match result {
        Ok(view) => view,
        Err(error) => {
            app.state::<BrowserState>()
                .inner
                .lock()
                .unwrap()
                .sources
                .remove(&label);
            return Err(error.to_string());
        }
    };
    view.hide().map_err(|e| e.to_string())?;
    Ok(view)
}

#[tauri::command]
pub async fn browser_prepare(
    app: AppHandle,
    webview: Webview,
    account: Account,
) -> Result<Value, String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    let state = app.state::<BrowserState>();
    let _operation = state.operations.lock().await;
    let view = prepare(&app, &account)?;
    restore_session(&app, &view, &account).await?;
    view.navigate(account.url().parse().unwrap())
        .map_err(|e| e.to_string())?;
    let url = view.url().map_err(|e| e.to_string())?;
    Ok(
        json!({ "url": if url.as_str() == "about:blank" { account.url() } else { url.as_str() } }),
    )
}

#[tauri::command]
pub async fn browser_show(
    app: AppHandle,
    webview: Webview,
    account_id: String,
    bounds: Bounds,
    visible: bool,
) -> Result<(), String> {
    require_main(&webview)?;
    if ![bounds.left, bounds.top, bounds.width, bounds.height]
        .iter()
        .all(|v| v.is_finite())
        || bounds.width <= 0.0
        || bounds.height <= 0.0
    {
        return Err("网页区域尺寸无效".into());
    }
    let state = app.state::<BrowserState>();
    let _operation = state.operations.lock().await;
    let account = account_for(&app, &account_id)?;
    let label = view_label(&app, &account, true);
    hide_workspaces(&app, Some(&label))?;
    let view = app.get_webview(&label).ok_or("账号网页尚未准备")?;
    let (bounds_changed, was_visible) = {
        let inner = state.inner.lock().unwrap();
        (
            inner.workspace_bounds.get(&label) != Some(&bounds),
            inner.visible_workspace.as_deref() == Some(label.as_str()),
        )
    };
    if bounds_changed {
        view.set_bounds(Rect {
            position: LogicalPosition::new(bounds.left, bounds.top).into(),
            size: LogicalSize::new(bounds.width, bounds.height).into(),
        })
        .map_err(|e| e.to_string())?;
        state.inner.lock().unwrap().workspace_bounds.insert(label.clone(), bounds);
    }
    if visible != was_visible {
        if visible {
            view.show().map_err(|e| e.to_string())?;
        } else {
            view.hide().map_err(|e| e.to_string())?;
        }
        state.inner.lock().unwrap().visible_workspace = visible.then_some(label);
    }
    Ok(())
}

fn hide_workspaces(app: &AppHandle, except: Option<&str>) -> Result<(), String> {
    let state = app.state::<BrowserState>();
    let label = state.inner.lock().unwrap().visible_workspace.clone();
    if let Some(label) = label.filter(|label| Some(label.as_str()) != except) {
        if let Some(view) = app.get_webview(&label) {
            view.hide().map_err(|e| e.to_string())?;
        }
        state.inner.lock().unwrap().visible_workspace = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_hide(app: AppHandle, webview: Webview) -> Result<(), String> {
    require_main(&webview)?;
    let state = app.state::<BrowserState>();
    let _operation = state.operations.lock().await;
    let (sender, receiver) = oneshot::channel();
    let hide_app = app.clone();
    // Wry executes hide synchronously on the UI thread. Acknowledge that execution,
    // not just message dispatch, before the main WebView mounts its DOM dialog.
    app.run_on_main_thread(move || {
        let _ = sender.send(hide_workspaces(&hide_app, None));
    })
    .map_err(|error| error.to_string())?;
    receiver.await.map_err(|_| "网页隐藏已取消".to_string())?
}

/// Capture before hiding a ready workspace. Lifecycle changes wait for the native
/// callback, but platform tasks keep running and the result is returned only to main.
#[tauri::command]
pub async fn browser_snapshot(
    app: AppHandle,
    webview: Webview,
    account_id: String,
) -> Result<String, String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    let state = app.state::<BrowserState>();
    let _operation = state.operations.lock().await;
    let account = account_for(&app, &account_id)?;
    let view = app
        .get_webview(&view_label(&app, &account, true))
        .ok_or("账号网页尚未准备")?;
    crate::browser_snapshot::capture(&view).await
}

#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    webview: Webview,
    account_id: String,
    url: Option<String>,
) -> Result<(), String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    let state = app.state::<BrowserState>();
    let _operation = state.operations.lock().await;
    if task_running(&app, &account_id) {
        return Err("请先停止此账号的任务".into());
    }
    let account = account_for(&app, &account_id)?;
    let target: Url = url
        .as_deref()
        .unwrap_or(account.url())
        .parse()
        .map_err(|_| "网页地址无效")?;
    if target.scheme() != "https" {
        return Err("平台网页必须使用 HTTPS".into());
    }
    app.get_webview(&view_label(&app, &account, true))
        .ok_or("账号网页尚未准备")?
        .navigate(target)
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryDirection {
    Back,
    Forward,
}

/// Open platform profiles or the official Chrome installer page in the system browser.
#[tauri::command]
pub async fn browser_open_external(
    app: AppHandle,
    webview: Webview,
    url: String,
) -> Result<(), String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    let target = Url::parse(&url).map_err(|_| "网页地址无效")?;
    let platform = target.scheme() == "https"
        && matches!(target.host_str(), Some("cps.kwaixiaodian.com" | "buyin.jinritemai.com"));
    if !platform && target.as_str() != "https://www.google.cn/chrome/" {
        return Err("不支持打开此网页".into());
    }
    tauri::async_runtime::spawn_blocking(move || open_system_browser(target.as_str()))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(target_os = "macos")]
fn open_system_browser(url: &str) -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("系统浏览器启动失败：{status}"))
    }
}

#[cfg(target_os = "windows")]
fn open_system_browser(url: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let target: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: target is a live, NUL-terminated UTF-16 buffer for this synchronous call.
    // Null operation selects the URL's default handler; no parameters or directory are passed.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    } as isize;
    if result > 32 {
        Ok(())
    } else {
        Err(format!("系统浏览器启动失败（{result}）"))
    }
}

#[tauri::command]
pub async fn browser_history(
    app: AppHandle,
    webview: Webview,
    account_id: String,
    direction: HistoryDirection,
) -> Result<(), String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    let state = app.state::<BrowserState>();
    let _operation = state.operations.lock().await;
    if task_running(&app, &account_id) {
        return Err("请先停止此账号的任务".into());
    }
    let account = account_for(&app, &account_id)?;
    // Browser history also contains the platform's same-document routes. Let the
    // WebView perform traversal; at either end it remains on the current page.
    let script = match direction {
        HistoryDirection::Back => "window.history.back()",
        HistoryDirection::Forward => "window.history.forward()",
    };
    app.get_webview(&view_label(&app, &account, true))
        .ok_or("账号网页尚未准备")?
        .eval(script)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_login(
    app: AppHandle,
    webview: Webview,
    account: Account,
    in_workspace: Option<bool>,
) -> Result<(), String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    let state = app.state::<BrowserState>();
    let _operation = state.operations.lock().await;
    if task_running(&app, &account.id) {
        return Err("请先停止此账号的任务".into());
    }
    let workspace = prepare(&app, &account)?;
    restore_session(&app, &workspace, &account).await?;
    if in_workspace == Some(true) {
        return workspace
            .navigate(account.platform.login_url().parse().unwrap())
            .map_err(|e| e.to_string());
    }
    let label = view_label(&app, &account, false);
    if let Some(window) = app.get_window(&label) {
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    register(&app, &account, false);
    let title = format!(
        "{} · {}",
        if account.platform == Platform::Kuaishou {
            "快手"
        } else {
            "抖音"
        },
        account.name.as_deref().unwrap_or("登录账号")
    );
    let window = WindowBuilder::new(&app, &label)
        .title(title)
        .inner_size(1120.0, 800.0)
        .min_inner_size(900.0, 640.0)
        .build()
        .map_err(|e| e.to_string())?;
    let view = window
        .add_child(
            builder(&app, &account, false).auto_resize(),
            LogicalPosition::new(0, 0),
            window.inner_size().map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    let save_app = app.clone();
    let save_account = account.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let app = save_app.clone();
            let account = save_account.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = save_session(&app, &account).await {
                    crate::cookies::report(&app, &account.id, &error);
                }
                if let Some(window) = app.get_window(&view_label(&app, &account, false)) {
                    let _ = window.destroy();
                }
            });
        }
    });
    let close_app = app.clone();
    let close_label = label.clone();
    let close_account = account.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            cancel_pending(&close_app, &close_label);
            close_app
                .state::<BrowserState>()
                .inner
                .lock()
                .unwrap()
                .sources
                .remove(&close_label);
            if account_for(&close_app, &close_account.id).is_ok()
                && !task_running(&close_app, &close_account.id)
            {
                if let Some(workspace) =
                    close_app.get_webview(&view_label(&close_app, &close_account, true))
                {
                    let _ = workspace
                        .navigate(close_account.platform.workspace_url().parse().unwrap());
                }
            }
        }
    });
    view.navigate(account.platform.login_url().parse().unwrap())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_finish_login(
    app: AppHandle,
    webview: Webview,
    account_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    license::require_valid(&app)?;
    let state = app.state::<BrowserState>();
    let _operation = state.operations.lock().await;
    let account = account_for(&app, &account_id)?;
    if let Some(window) = app.get_window(&view_label(&app, &account, false)) {
        save_session(&app, &account).await?;
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_remove(
    app: AppHandle,
    webview: Webview,
    account_id: String,
) -> Result<(), String> {
    require_main(&webview)?;
    let state = app.state::<BrowserState>();
    let _operation = state.operations.lock().await;
    if task_running(&app, &account_id) {
        return Err("请先停止此账号的任务".into());
    }
    // Accounts can be removed immediately after a restart, before any platform
    // page has been prepared. Use the same persisted metadata as runtime_load.
    let account = match account_for(&app, &account_id) {
        Ok(account) => account,
        Err(_) => {
            let value = crate::storage::account(&app, account_id.clone()).await?;
            serde_json::from_value::<Account>(value).map_err(|e| e.to_string())?
        }
    };
    // Open only about:blank to obtain the account's native data store for clear.
    let view = prepare(&app, &account)?;
    let workspace_label = view_label(&app, &account, true);
    let login_label = view_label(&app, &account, false);
    cancel_pending(&app, &workspace_label);
    cancel_pending(&app, &login_label);
    state.inner.lock().unwrap().accounts.remove(&account_id);
    state.inner.lock().unwrap().restored.remove(&account_id);
    if let Some(window) = app.get_window(&login_label) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    view.clear_all_browsing_data().map_err(|e| e.to_string())?;
    view.close().map_err(|e| e.to_string())?;
    {
        let mut inner = state.inner.lock().unwrap();
        inner.workspace_bounds.remove(&workspace_label);
        if inner.visible_workspace.as_deref() == Some(workspace_label.as_str()) {
            inner.visible_workspace = None;
        }
    }
    crate::cookies::remove(&app, &store_id(&app, &account).to_string()).await?;
    // WebView2 owns profile files until its process exits. Clear website data
    // through the native API instead of racing its file locks with remove_dir_all.
    state
        .inner
        .lock()
        .unwrap()
        .sources
        .retain(|_, source| source.account_id != account_id);
    Ok(())
}

#[derive(Deserialize, Serialize)]
pub struct OwnRequest {
    path: String,
    body: Option<Value>,
}

#[tauri::command]
pub async fn platform_eval(
    app: AppHandle,
    webview: Webview,
    account_id: String,
    script: String,
    task: bool,
    request: Option<OwnRequest>,
) -> Result<Value, Value> {
    let before_send = |message: String| json!({"message": message, "beforeSend": true});
    require_main(&webview).map_err(before_send)?;
    // Read the latest native result; beforeSend distinguishes a blocked request from a sent invitation.
    license::require_valid(&app)
        .map_err(|message| json!({"message":message,"beforeSend":true,"license":true}))?;
    if task && !task_running(&app, &account_id) {
        return Err(json!({"message":"任务已停止","beforeSend":true,"stopped":true}));
    }
    let account = account_for(&app, &account_id).map_err(before_send)?;
    let label = view_label(&app, &account, true);
    let view = app
        .get_webview(&label)
        .ok_or_else(|| before_send("账号网页尚未准备".into()))?;
    let url = view.url().map_err(|e| before_send(e.to_string()))?;
    let source = app.state::<BrowserState>().inner.lock().unwrap().sources[&label].clone();
    if !source_allows(&source, &url) {
        return Err(json!({"message":"请先登录并打开达人邀约页面","beforeSend":true,"login":true}));
    }
    let request_id = Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    app.state::<BrowserState>()
        .inner
        .lock()
        .unwrap()
        .pending
        .insert(
            request_id.clone(),
            Pending {
                source: label,
                sender,
            },
        );
    let javascript = format!(
        "window.__DALANCHONG_BRIDGE__.run({}, () => ({}), {}).catch(() => {{}})",
        serde_json::to_string(&request_id).unwrap(),
        script,
        serde_json::to_string(&request).unwrap(),
    );
    if let Err(error) = view.eval(javascript) {
        app.state::<BrowserState>()
            .inner
            .lock()
            .unwrap()
            .pending
            .remove(&request_id);
        // Native eval errors do not prove whether a network request was sent.
        return Err(json!({"message":error.to_string()}));
    }
    let result = tokio::time::timeout(Duration::from_secs(60), receiver).await;
    app.state::<BrowserState>()
        .inner
        .lock()
        .unwrap()
        .pending
        .remove(&request_id);
    match result {
        Ok(Ok(Ok(value))) => Ok(value),
        Ok(Ok(Err(message))) => Err(json!({"message":message})),
        Ok(Err(_)) => Err(json!({"message":"平台页面已关闭，执行结果未知"})),
        Err(_) => Err(json!({"message":"平台请求等待超时，执行结果未知"})),
    }
}

#[tauri::command]
/// Resolve the pending request only after source validation; unknown IDs are not new work.
/// The async command wrapper also moves large result deserialization off UI dispatch.
pub async fn platform_result(
    app: AppHandle,
    webview: Webview,
    request_id: String,
    result: Value,
    error: Option<String>,
) -> Result<(), String> {
    caller_source(&app, &webview)?;
    let state = app.state::<BrowserState>();
    let mut inner = state.inner.lock().unwrap();
    let pending = inner.pending.get(&request_id).ok_or("平台请求已结束")?;
    if pending.source != webview.label() {
        return Err("平台请求回传来源不匹配".into());
    }
    let pending = inner.pending.remove(&request_id).unwrap();
    let _ = pending.sender.send(match error {
        Some(error) => Err(error.chars().take(8000).collect()),
        None => Ok(result),
    });
    Ok(())
}

fn sensitive(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "cookie",
        "token",
        "authorization",
        "password",
        "secret",
        "phone",
        "mobile",
        "wechat",
        "contact",
        "license",
        "activation",
    ]
    .iter()
    .any(|word| key.contains(word))
}

fn redact(value: &mut Value) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if sensitive(key) {
                    *value = json!("[已隐藏]");
                } else {
                    redact(value);
                }
            }
        }
        Value::Array(array) => {
            for value in array {
                redact(value);
            }
        }
        _ => {}
    }
}

fn clean_url(mut url: Url) -> String {
    let query: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| !sensitive(key))
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    url.set_query(None);
    if !query.is_empty() {
        url.query_pairs_mut().extend_pairs(query);
    }
    url.set_fragment(None);
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.to_string()
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedRequest {
    kind: String,
    path: String,
    url: String,
    method: String,
    body: Value,
    sequence: u64,
    document_id: String,
    page_url: String,
    route_revision: u64,
    phase: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservedResponse {
    text: String,
    status: u16,
    url: String,
    request_id: String,
}

#[derive(Deserialize)]
pub struct InvitationObservation {
    request: ObservedRequest,
    response: Option<ObservedResponse>,
    error: Option<String>,
}

#[derive(Serialize)]
struct OrderedRequest<'a> {
    #[serde(flatten)]
    request: &'a ObservedRequest,
    order: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObservationEvent<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    account_id: &'a str,
    source: &'a str,
    workspace: bool,
    request: OrderedRequest<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    response: Option<&'a ObservedResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// Remote pages may only report their own current URL. This is an SPA transition,
// so it clears collection context without interrupting evals or emitting loading.
#[tauri::command]
pub fn platform_route(
    app: AppHandle,
    webview: Webview,
    url: String,
    document_id: String,
    route_revision: u64,
) -> Result<(), String> {
    let (source, current_url) = caller_source(&app, &webview)?;
    let url: Url = url.parse().map_err(|_| "平台页面地址无效")?;
    if !source_allows(&source, &url) || document_id.is_empty() || document_id.len() > 64 {
        return Err("平台页面来源无效".into());
    }
    if current_url != url {
        return Ok(());
    }
    {
        let state = app.state::<BrowserState>();
        let mut inner = state.inner.lock().unwrap();
        if let Some(route) = inner.routes.get(webview.label()) {
            if route.document_id != document_id || route.revision >= route_revision {
                return Ok(());
            }
        }
        inner.routes.insert(
            webview.label().to_string(),
            PageRoute {
                document_id,
                revision: route_revision,
            },
        );
        inner
            .latest
            .remove(&(webview.label().to_string(), "list".into()));
    }
    emit(
        &app,
        &source,
        webview.label(),
        json!({"type":"route", "url":clean_url(url)}),
    );
    Ok(())
}

#[tauri::command]
// The page bridge serializes and awaits reports; process large JSON bodies off the UI thread.
pub async fn platform_observe(
    app: AppHandle,
    webview: Webview,
    mut payload: InvitationObservation,
) -> Result<(), String> {
    let (source, current_url) = caller_source(&app, &webview)?;
    let request = &mut payload.request;
    let url: Url = request.url.parse().map_err(|_| "观察请求地址无效")?;
    let page_url: Url = request.page_url.parse().map_err(|_| "观察页面地址无效")?;
    if url.origin().ascii_serialization() != source.platform.origin()
        || source.platform.kind(url.path()) != Some(request.kind.as_str())
        || url.path() != request.path
        || !matches!(request.method.as_str(), "GET" | "POST")
        || !matches!(request.phase.as_str(), "pending" | "complete")
        || !source_allows(&source, &page_url)
        || request.document_id.is_empty()
        || request.document_id.len() > 64
    {
        return Err("不支持的观察请求".into());
    }
    if request.kind == "list"
        && !source.platform.supports_list(&page_url, &request.path, &request.body)
    {
        return Err("不支持的业务场景".into());
    }
    if source.platform == Platform::Kuaishou
        && request.kind == "quota"
        && !url.query_pairs().any(|(key, value)| key == "inviteType" && value == "1")
    {
        return Err("不支持的邀约类型".into());
    }
    if current_url != page_url {
        return Ok(());
    }
    if request.body.to_string().len() > MAX_BODY {
        return Err("观察请求正文过大".into());
    }
    request.url = clean_url(url);
    request.page_url = clean_url(page_url);
    if let Some(response) = &mut payload.response {
        if response.text.len() > MAX_BODY {
            return Err("观察响应正文过大".into());
        }
        response.url = clean_url(response.url.parse().map_err(|_| "观察响应地址无效")?);
        response.request_id = response.request_id.chars().take(256).collect();
    }
    let order = {
        let state = app.state::<BrowserState>();
        let mut inner = state.inner.lock().unwrap();
        if let Some(route) = inner.routes.get(webview.label()) {
            if route.document_id != request.document_id || route.revision != request.route_revision {
                return Ok(());
            }
        } else if request.phase == "pending" {
            inner.routes.insert(
                webview.label().to_string(),
                PageRoute {
                    document_id: request.document_id.clone(),
                    revision: request.route_revision,
                },
            );
        } else {
            return Ok(());
        }
        let key = (webview.label().to_string(), request.kind.clone());
        if request.phase == "pending" {
            if inner.latest.get(&key).is_some_and(|latest| {
                latest.document_id == request.document_id
                    && latest.route_revision == request.route_revision
                    && latest.sequence >= request.sequence
            }) {
                return Ok(());
            }
            inner.order += 1;
            let order = inner.order;
            inner.latest.insert(
                key,
                Observation {
                    document_id: request.document_id.clone(),
                    route_revision: request.route_revision,
                    sequence: request.sequence,
                    order,
                },
            );
            order
        } else {
            let Some(latest) = inner.latest.get(&key) else {
                return Ok(());
            };
            if latest.document_id != request.document_id
                || latest.route_revision != request.route_revision
                || latest.sequence != request.sequence
            {
                return Ok(());
            }
            latest.order
        }
    };
    // Reject superseded document/route/request completions before parsing their
    // potentially multi-megabyte JSON. Accepted payloads are still redacted before IPC.
    redact(&mut payload.request.body);
    if let Some(response) = &mut payload.response {
        if let Ok(mut body) = serde_json::from_str::<Value>(&response.text) {
            redact(&mut body);
            response.text = body.to_string();
        } else {
            // Non-JSON diagnostic bodies can contain credentials in HTML.
            response.text = "[平台未返回 JSON 正文]".into();
        }
    }
    // Serialize the sanitized payload directly; converting it through Value would
    // clone the entire request and multi-megabyte response before IPC serialization.
    let event = ObservationEvent {
        kind: "response",
        account_id: &source.account_id,
        source: webview.label(),
        workspace: source.workspace,
        request: OrderedRequest { request: &payload.request, order },
        response: payload.response.as_ref(),
        error: payload.error.as_ref().map(|error| error.chars().take(8000).collect()),
    };
    let _ = app.emit_to("main", "assistant:browser", &event);
    if payload.request.phase == "complete"
        && matches!(payload.request.kind.as_str(), "account" | "quota")
    {
        let app = app.clone();
        let id = source.account_id.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(account) = account_for(&app, &id) {
                if let Err(error) = save_session(&app, &account).await {
                    crate::cookies::report(&app, &id, &error);
                }
            }
        });
    }
    Ok(())
}

async fn restore_session(app: &AppHandle, view: &Webview, account: &Account) -> Result<(), String> {
    if app
        .state::<BrowserState>()
        .inner
        .lock()
        .unwrap()
        .restored
        .contains(&account.id)
    {
        return Ok(());
    }
    if let Err(error) =
        crate::cookies::restore(app, view, &store_id(app, account).to_string()).await
    {
        crate::cookies::report(
            app,
            &account.id,
            &format!("恢复失败，原登录快照已保留：{error}"),
        );
    }
    app.state::<BrowserState>()
        .inner
        .lock()
        .unwrap()
        .restored
        .insert(account.id.clone());
    Ok(())
}
async fn save_session(app: &AppHandle, account: &Account) -> Result<(), String> {
    let view = app
        .get_webview(&view_label(app, account, true))
        .ok_or("账号网页已关闭")?;
    if !crate::cookies::save(app, &view, &store_id(app, account).to_string()).await? {
        return Ok(());
    }
    let saved_at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    app.emit_to(
        "main",
        "assistant:event",
        json!({"type":"account", "id":account.id, "patch":{"savedAt":saved_at}}),
    )
    .map_err(|e| e.to_string())
}
pub async fn flush_sessions(app: &AppHandle) -> Result<(), String> {
    let accounts: Vec<_> = app
        .state::<BrowserState>()
        .inner
        .lock()
        .unwrap()
        .accounts
        .values()
        .cloned()
        .collect();
    for account in accounts {
        save_session(app, &account).await?;
    }
    Ok(())
}
