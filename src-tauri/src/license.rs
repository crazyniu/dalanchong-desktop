//! AI module map
//! Purpose: keep online licensing authoritative in the native process.
//! Entry: monitor and explicit license_verify verify saved codes; license_state reads display state;
//! license_activate binds a user-entered code; require_valid reads the latest native result.
//! license_saved_code returns the saved code only to the trusted main activation form.
//! Flow: read only the activation code from license-tauri.json, derive device identity
//! through device.rs, call the HTTPS service, and emit license state to the main UI.
//! State: monitor verifies once at startup and every 600 seconds, including after failure.
//! An async mutex serializes service calls; a separate short-lived state lock lets
//! business operations read the latest result without waiting for the network.
//! Request failures retain an in-memory diagnostic for the activation form to copy;
//! diagnostics contain transport errors and selected response headers, never bodies or codes.
//! Invariants: the server owns validity/expiry and one-code/one-device binding. Never
//! activate as a verification fallback, trust persisted validity, or accept a client-supplied
//! device ID. Failed replacement codes preserve the previous code. Cleanup can still run
//! after expiry. State snapshots and events never expose the stored activation code.

use serde_json::{json, Value};
use std::{error::Error, path::PathBuf, sync::Mutex as StateMutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, Webview};
use tokio::sync::Mutex;

const API: &str = "https://dabudian.top/functions/v1/license-api";
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
        "request_timeout" => "授权请求超时（15 秒）",
        "connection_error" => "无法建立授权连接，请复制错误详情",
        "request_error" => "授权请求失败，请复制错误详情",
        "response_timeout" => "已连接授权服务，但接收响应超时",
        "response_error" => "已连接授权服务，但响应接收失败",
        "invalid_response" => "授权服务响应格式错误，请复制错误详情",
        _ => "",
    }
}

fn result_message(result: &Value) -> String {
    let reason = result["reason"].as_str().unwrap_or("");
    if reason == "http_error" {
        return format!("授权服务返回 HTTP {}", result["diagnostic"]["httpStatus"]);
    }
    message(reason).to_string()
}

fn request_failure(reason: &str, stage: &str, detail: String, mut diagnostic: Value) -> Value {
    diagnostic["stage"] = json!(stage);
    diagnostic["detail"] = json!(detail);
    json!({"valid": false, "reason": reason, "diagnostic": diagnostic})
}

/// Preserve the transport's cause chain, which distinguishes DNS, TLS and proxy errors.
/// Request bodies are never formatted; the endpoint is recorded separately without credentials.
fn transport_detail(error: reqwest::Error) -> String {
    let error = error.without_url();
    let mut detail = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        detail.push_str(": ");
        detail.push_str(&cause.to_string());
        source = cause.source();
    }
    detail
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
            "expiresAt": null,
            "diagnostic": null
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
        let endpoint = format!("{API}/{action}");
        let mut diagnostic = json!({
            "time": time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap(),
            "action": action,
            "endpoint": endpoint,
            "appVersion": env!("CARGO_PKG_VERSION"),
            "os": std::env::consts::OS
        });
        let response = self
            .client
            .post(&endpoint)
            .json(&json!({
                "app_id": "dalanchong",
                "code": code,
                "device_id": device_id
            }))
            .send()
            .await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                let reason = if error.is_timeout() {
                    "request_timeout"
                } else if error.is_connect() {
                    "connection_error"
                } else {
                    "request_error"
                };
                return request_failure(reason, "request", transport_detail(error), diagnostic);
            }
        };
        let status = response.status();
        diagnostic["httpStatus"] = json!(status.as_u16());
        for (field, header) in [
            ("requestId", "sb-request-id"),
            ("cfRay", "cf-ray"),
            ("contentType", "content-type"),
        ] {
            diagnostic[field] = json!(response
                .headers()
                .get(header)
                .and_then(|value| value.to_str().ok()));
        }
        if !status.is_success() {
            return request_failure("http_error", "http", status.to_string(), diagnostic);
        }
        match response.json::<Value>().await {
            Ok(mut result) if result["valid"].is_boolean() && result["reason"].is_string() => {
                // Diagnostics describe native transport failures, not fields supplied by the server.
                result["diagnostic"] = Value::Null;
                result
            }
            Ok(_) => request_failure(
                "invalid_response",
                "protocol",
                "Response is missing valid or reason".into(),
                diagnostic,
            ),
            Err(error) => {
                let (reason, stage) = if error.is_timeout() {
                    ("response_timeout", "body")
                } else if error.is_decode() {
                    ("invalid_response", "decode")
                } else {
                    ("response_error", "body")
                };
                request_failure(reason, stage, transport_detail(error), diagnostic)
            }
        }
    }

    fn publish(&self, app: &AppHandle, result: Value) -> Value {
        let reason = result["reason"].as_str().unwrap_or("");
        let state = json!({
            "checked": true,
            "valid": result["valid"] == true,
            "reason": reason,
            "message": result_message(&result),
            "deviceId": self.device_id.as_deref().unwrap_or(""),
            "hasCode": !self.code.is_empty(),
            "activatedAt": result["activated_at"],
            "expiresAt": result["expires_at"],
            "diagnostic": result["diagnostic"]
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

/// Read only the latest monitor/explicit verification/activation result; never query from a business operation.
pub fn require_valid(app: &AppHandle) -> Result<(), String> {
    let service = app.state::<License>();
    let result = service.state.lock().unwrap();
    if result["valid"] == true {
        Ok(())
    } else {
        Err(result["message"].as_str().unwrap_or("授权无效").into())
    }
}

/// Own startup/periodic verification and recovery after a failed check. Explicit
/// user verification shares the service mutex without changing this schedule.
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

/// The activation form reads its saved input without waiting for the service's
/// network mutex. The fixed local file is read only; no code enters state/events/diagnostics.
#[tauri::command]
pub async fn license_saved_code(app: AppHandle, webview: Webview) -> Result<String, String> {
    crate::require_main(&webview)?;
    let file = crate::data_dir(&app).join("license-tauri.json");
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = match std::fs::read(file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(String::new()),
            Err(error) => return Err(format!("读取已保存激活码失败：{error}")),
        };
        let saved: Value = serde_json::from_slice(&bytes)
            .map_err(|error| format!("读取已保存激活码失败：{error}"))?;
        Ok(saved["code"].as_str().unwrap_or("").to_owned())
    }).await.map_err(|error| error.to_string())?
}

/// Verify only the locally saved code with the native device identity. This is
/// an explicit user action, not activation or an automatic retry after failure.
#[tauri::command]
pub async fn license_verify(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    let service = app.state::<License>();
    let state = service.service.lock().await.verify(&app).await;
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
            "message": result_message(&result),
            "diagnostic": result["diagnostic"]
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
