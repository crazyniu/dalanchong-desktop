use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{collections::HashSet, path::PathBuf};
use tauri::{AppHandle, Manager, Webview};

#[derive(Default)]
pub struct CookieStore(pub tokio::sync::Mutex<()>);

fn file(app: &AppHandle, id: &str) -> PathBuf {
    crate::data_dir(app).join(format!("{id}.tauri-cookies"))
}
fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.local.ecommerceassistant.cookies", id).map_err(|e| e.to_string())
}
fn cipher(id: &str, create: bool) -> Result<Aes256Gcm, String> {
    let entry = entry(id)?;
    let key = match entry.get_password() {
        Ok(value) => STANDARD.decode(value).map_err(|e| e.to_string())?,
        Err(keyring::Error::NoEntry) if create => {
            let mut key = vec![0u8; 32];
            getrandom::fill(&mut key).map_err(|e| e.to_string())?;
            entry
                .set_password(&STANDARD.encode(&key))
                .map_err(|e| e.to_string())?;
            key
        }
        Err(error) => return Err(error.to_string()),
    };
    Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())
}

pub async fn save(app: &AppHandle, view: &Webview, id: &str) -> Result<(), String> {
    let state = app.state::<CookieStore>();
    let _lock = state.0.lock().await;
    let cookies = view.cookies().map_err(|e| e.to_string())?;
    let content =
        serde_json::to_vec(&cookies.iter().map(ToString::to_string).collect::<Vec<_>>()).unwrap();
    let mut nonce = [0u8; 12];
    getrandom::fill(&mut nonce).map_err(|e| e.to_string())?;
    let encrypted = cipher(id, true)?
        .encrypt(Nonce::from_slice(&nonce), content.as_ref())
        .map_err(|_| "Cookie 加密失败")?;
    let payload =
        serde_json::json!({"nonce":STANDARD.encode(nonce),"ciphertext":STANDARD.encode(encrypted)});
    crate::storage::write_json(&file(app, id), &payload).map_err(|e| e.to_string())
}

pub async fn restore(app: &AppHandle, view: &Webview, id: &str) -> Result<(), String> {
    let state = app.state::<CookieStore>();
    let _lock = state.0.lock().await;
    let path = file(app, id);
    if !path.exists() {
        return Ok(());
    }
    let payload: serde_json::Value =
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let nonce = STANDARD
        .decode(payload["nonce"].as_str().ok_or("Cookie 快照无效")?)
        .map_err(|e| e.to_string())?;
    if nonce.len() != 12 {
        return Err("Cookie 快照无效".into());
    }
    let encrypted = STANDARD
        .decode(payload["ciphertext"].as_str().ok_or("Cookie 快照无效")?)
        .map_err(|e| e.to_string())?;
    let plain = cipher(id, false)?
        .decrypt(Nonce::from_slice(&nonce), encrypted.as_ref())
        .map_err(|_| "Cookie 快照无法解密，请重新登录")?;
    let cookies: Vec<String> = serde_json::from_slice(&plain).map_err(|e| e.to_string())?;
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
                .map(|expiry| {
                    expiry.unix_timestamp()
                        > std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs() as i64
                })
                .unwrap_or(true)
        {
            view.set_cookie(cookie).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub async fn remove(app: &AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<CookieStore>();
    let _lock = state.0.lock().await;
    let path = file(app, id);
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    match entry(id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn report(app: &AppHandle, account_id: &str, error: &str) {
    use std::io::Write;
    let entry = serde_json::json!({"id":uuid::Uuid::new_v4().to_string(),"time":time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339).unwrap(),"accountId":account_id,"level":"error","message":format!("保存登录数据失败：{error}")});
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(crate::data_dir(app).join("errors.ndjson"))
    {
        let _ = writeln!(file, "{entry}");
    }
}
