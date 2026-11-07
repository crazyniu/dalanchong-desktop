//! AI module map
//! Purpose: supplement native WebView session persistence with local cookie snapshots.
//! Entry: browser.rs calls save, restore, remove, and report using its stable store ID.
//! Flow: serialize cookie strings to <store-id>.session-cookies.json through write_json;
//! restore only unexpired entries absent from the live name/domain/path key set.
//! State: CookieStore serializes snapshot changes across account views and remembers
//! successfully written cookies, avoiding duplicate fsyncs while the file still exists.
//! Snapshot content reads/writes and removal run on blocking workers; writes serialize
//! the cookie vector directly and return it without constructing a second JSON value tree.
//! Invariants: do not overwrite newer live cookies, read the legacy keychain, or log
//! cookie values. A snapshot is login data, never a license identity or authorization.

use std::{collections::{HashMap, HashSet}, path::PathBuf};
use tauri::{AppHandle, Manager, Webview};

#[derive(Default)]
pub struct CookieStore(pub tokio::sync::Mutex<HashMap<String, Vec<String>>>);

fn file(app: &AppHandle, id: &str) -> PathBuf {
    crate::data_dir(app).join(format!("{id}.session-cookies.json"))
}

pub async fn save(app: &AppHandle, view: &Webview, id: &str) -> Result<bool, String> {
    let state = app.state::<CookieStore>();
    let mut snapshots = state.0.lock().await;
    let mut cookies: Vec<_> = view.cookies().map_err(|e| e.to_string())?
        .iter().map(ToString::to_string).collect();
    cookies.sort_unstable();
    let path = file(app, id);
    if snapshots.get(id) == Some(&cookies) && path.is_file() {
        return Ok(false);
    }
    let cookies = tauri::async_runtime::spawn_blocking(move || {
        crate::storage::write_json(&path, &cookies).map_err(|e| e.to_string())?;
        Ok::<_, String>(cookies)
    }).await.map_err(|e| e.to_string())??;
    snapshots.insert(id.to_owned(), cookies);
    Ok(true)
}

pub async fn restore(app: &AppHandle, view: &Webview, id: &str) -> Result<(), String> {
    let state = app.state::<CookieStore>();
    let _lock = state.0.lock().await;
    let path = file(app, id);
    let cookies: Vec<String> = tauri::async_runtime::spawn_blocking(move || {
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(error.to_string()),
        }
    }).await.map_err(|e| e.to_string())??;
    if cookies.is_empty() { return Ok(()); }
    let live: HashSet<_> = view
        .cookies()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|c| {
            (
                c.name().to_string(),
                c.domain().unwrap_or("").to_string(),
                c.path().unwrap_or("/").to_string(),
            )
        })
        .collect();
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    for raw in cookies {
        let cookie = tauri::webview::Cookie::parse(raw).map_err(|e| e.to_string())?;
        let key = (
            cookie.name().to_string(),
            cookie.domain().unwrap_or("").to_string(),
            cookie.path().unwrap_or("/").to_string(),
        );
        if !live.contains(&key)
            && cookie
                .expires_datetime()
                .map(|expiry| expiry.unix_timestamp() > now)
                .unwrap_or(true)
        {
            view.set_cookie(cookie).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub async fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<CookieStore>();
    let mut snapshots = state.0.lock().await;
    let path = file(app, id);
    tauri::async_runtime::spawn_blocking(move || {
        match std::fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }).await.map_err(|e| e.to_string())??;
    snapshots.remove(id);
    Ok(())
}

pub fn report(app: &AppHandle, account_id: &str, error: &str) {
    let entry = serde_json::json!({"id":uuid::Uuid::new_v4().to_string(),"time":time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),"accountId":account_id,"level":"error","message":format!("保存登录数据失败：{error}")});
    crate::storage::append_error(app, entry);
}
