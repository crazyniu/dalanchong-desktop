//! AI module map
//! Purpose: keep online licensing authoritative in the native process.
//! Entry: monitor verifies saved codes; license_state reads display state;
//! license_activate binds a user-entered code; require_valid reads the latest native result.
//! Flow: read only the activation code from license-tauri.json, derive device identity
//! through device.rs, call the HTTPS service, and emit license state to the main UI.
//! State: monitor verifies once at startup and every 600 seconds, including after failure.
//! An async mutex serializes service calls; a separate short-lived state lock lets
//! business operations read the latest result without waiting for the network.
//! Invariants: the server owns validity/expiry and one-code/one-device binding. Never
//! activate as a verification fallback, trust persisted validity, or accept a client-supplied
//! device ID. Failed replacement codes preserve the previous code. Cleanup can still run
//! after expiry. UI state must never expose the stored activation code.

use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex as StateMutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, Webview};
use tokio::sync::Mutex;

const API: &str = "https://lfrgswefkgdzhureqzod.supabase.co/functions/v1/license-api";
const MONITOR_INTERVAL: Duration = Duration::from_secs(600);

pub struct LicenseService {
    device_id: Option<String>,
    code: String,
    file: PathBuf,
    client: reqwest::Client,
}

pub struct License {
    service: Mutex<LicenseService>,
    state: StateMutex<Value>,
}

fn message(reason: &str) -> &'static str {
    match reason {
        "not_activated" => "请输入激活码",
        "invalid_license" => "激活码无效，请检查是否属于大懒虫",
        "device_unbound" => "设备已解绑，请重新激活",
        "device_mismatch" => "激活码已绑定其他设备 请联系管理员解绑",
        "device_disabled" => "此设备已被禁用，请联系管理员",
        "hardware_unavailable" => "无法读取硬件设备码，请重新启动软件",
        "expired" => "激活码已过期，请更换激活码",
        "network_error" => "无法连接授权服务，请检查网络",
        _ => "",
    }
}

impl License {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let directory = crate::data_dir(app);
        let file = directory.join("license-tauri.json");
        let saved: Value = if file.exists() {
            serde_json::from_slice(&std::fs::read(&file)?)?
        } else {
            json!({})
        };
        // Read only the legacy activation code; ignoring cached deviceId prevents copied data from inheriting identity.
        let device_id = crate::device::id();
        let code = saved["code"].as_str().unwrap_or("").to_string();
        let reason = if device_id.is_some() {
            "not_activated"
        } else {
            "hardware_unavailable"
        };
        let state = json!({
            "checked": false,
            "valid": false,
            "reason": reason,
            "message": message(reason),
            "deviceId": device_id.as_deref().unwrap_or(""),
            "hasCode": !code.is_empty(),
            "activatedAt": null,
            "expiresAt": null
        });
        Ok(Self {
            service: Mutex::new(LicenseService {
                device_id,
                code,
                file,
                client: reqwest::Client::builder()
                    .timeout(Duration::from_secs(15))
                    .build()?,
            }),
            state: StateMutex::new(state),
        })
    }
}

impl LicenseService {
    async fn call(&self, action: &str, code: &str) -> Value {
        let Some(device_id) = self.device_id.as_deref() else {
            return json!({"valid": false, "reason": "hardware_unavailable"});
        };
        let response = self
            .client
            .post(format!("{API}/{action}"))
            .json(&json!({
                "app_id": "dalanchong",
                "code": code,
                "device_id": device_id
            }))
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => response
                .json()
                .await
                .unwrap_or_else(|_| json!({"valid": false, "reason": "network_error"})),
            _ => json!({"valid": false, "reason": "network_error"}),
        }
    }

    fn publish(&self, app: &AppHandle, result: Value) -> Value {
        let reason = result["reason"].as_str().unwrap_or("");
        let state = json!({
            "checked": true,
            "valid": result["valid"] == true,
            "reason": reason,
            "message": message(reason),
            "deviceId": self.device_id.as_deref().unwrap_or(""),
            "hasCode": !self.code.is_empty(),
            "activatedAt": result["activated_at"],
            "expiresAt": result["expires_at"]
        });
        let license = app.state::<License>();
        let mut current = license.state.lock().unwrap();
        if *current == state {
            return state;
        }
        *current = state.clone();
        drop(current);
        let _ = app.emit_to(
            "main",
            "assistant:event",
            json!({"type": "license", "state": state}),
        );
        state
    }

    async fn verify(&mut self, app: &AppHandle) -> Value {
        if self.device_id.is_none() {
            self.device_id = crate::device::id();
        }
        // Verification must not activate: otherwise the old device could reclaim a binding after admin unbind.
        let result = if self.device_id.is_none() {
            json!({"valid": false, "reason": "hardware_unavailable"})
        } else if self.code.is_empty() {
            json!({"valid": false, "reason": "not_activated"})
        } else {
            self.call("verify", &self.code).await
        };
        self.publish(app, result)
    }
}

/// Read only the latest monitor/activation result; never query the service from a business operation.
pub fn require_valid(app: &AppHandle) -> Result<(), String> {
    let service = app.state::<License>();
    let result = service.state.lock().unwrap();
    if result["valid"] == true {
        Ok(())
    } else {
        Err(result["message"].as_str().unwrap_or("授权无效").into())
    }
}

/// Own all verification requests, including startup and recovery after a failed check.
pub async fn monitor(app: AppHandle) {
    let mut interval = tokio::time::interval(MONITOR_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        interval.tick().await;
        let service = app.state::<License>();
        service.service.lock().await.verify(&app).await;
    }
}

#[tauri::command]
pub fn license_state(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    let service = app.state::<License>();
    let state = service.state.lock().unwrap().clone();
    Ok(state)
}

#[tauri::command]
pub async fn license_activate(
    app: AppHandle,
    webview: Webview,
    code: String,
) -> Result<Value, String> {
    crate::require_main(&webview)?;
    let code: String = code
        .to_uppercase()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    let service = app.state::<License>();
    let mut license = service.service.lock().await;
    let result = if code.len() == 24
        && code
            .chars()
            .all(|c| "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(c))
    {
        license.call("activate", &code).await
    } else {
        json!({"valid": false, "reason": "invalid_license"})
    };
    if result["valid"] != true {
        // A failed replacement must preserve the previous code and valid state rather than revoke a working license.
        let response = json!({
            "valid": false,
            "message": message(result["reason"].as_str().unwrap_or("invalid_license"))
        });
        let valid = service.state.lock().unwrap()["valid"] == true;
        if !valid {
            license.publish(&app, result);
        }
        return Ok(response);
    }
    // Publish success only after binding and saving the code; device ID and validity are not local credentials.
    let path = license.file.clone();
    let saved = json!({"code": code});
    tauri::async_runtime::spawn_blocking(move || {
        crate::storage::write_json(&path, &saved).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())??;
    license.code = code;
    license.publish(&app, result);
    Ok(json!({"valid": true}))
}
