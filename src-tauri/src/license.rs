use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};
use tauri::{AppHandle, Emitter, Manager, Webview};
use tokio::sync::Mutex;

const API: &str = "https://lfrgswefkgdzhureqzod.supabase.co/functions/v1/license-api";

pub struct LicenseService {
    state: Value,
    code: String,
    file: PathBuf,
    client: reqwest::Client,
}

pub struct License(pub Mutex<LicenseService>);

fn message(reason: &str) -> &str {
    match reason {
        "not_activated" => "请输入激活码",
        "invalid_license" => "激活码无效，请检查是否属于大懒虫",
        "device_unbound" => "设备已解绑，请重新激活",
        "device_mismatch" => "激活码已绑定其他设备，请先在后台解绑",
        "device_disabled" => "此设备已被禁用，请联系管理员",
        "expired" => "激活码已过期，请更换激活码",
        "network_error" => "无法连接授权服务，请联网后重试",
        _ => "",
    }
}

impl License {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let directory = crate::data_dir(app);
        let file = directory.join("license-tauri.json");
        let legacy = directory.join("license.json");
        let saved: Value = if file.exists() {
            serde_json::from_slice(&std::fs::read(&file)?)?
        } else if legacy.exists() {
            let old: Value = serde_json::from_slice(&std::fs::read(legacy)?)?;
            json!({"deviceId": old["deviceId"]})
        } else {
            json!({"deviceId": uuid::Uuid::new_v4().to_string()})
        };
        crate::storage::write_json(&file, &saved)?;
        let device_id = saved["deviceId"].as_str().ok_or("设备标识无效")?;
        let code = saved["code"].as_str().unwrap_or("").to_string();
        let state = json!({
            "valid":false,"reason":"not_activated","message":"",
            "deviceId":device_id,"hasCode":!code.is_empty(),
            "activatedAt":null,"expiresAt":null
        });
        Ok(Self(Mutex::new(LicenseService {
            state,
            code,
            file,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()?,
        })))
    }
}

impl LicenseService {
    async fn call(&self, action: &str, code: &str) -> Value {
        let response = self
            .client
            .post(format!("{API}/{action}"))
            .json(&json!({"app_id":"dalanchong","code":code,"device_id":self.state["deviceId"]}))
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => response
                .json()
                .await
                .unwrap_or_else(|_| json!({"valid":false,"reason":"network_error"})),
            _ => json!({"valid":false,"reason":"network_error"}),
        }
    }

    fn publish(&mut self, app: &AppHandle, result: Value) -> Value {
        let reason = result["reason"].as_str().unwrap_or("");
        self.state = json!({
            "valid": result["valid"] == true,
            "reason":reason,"message":message(reason),
            "deviceId":self.state["deviceId"],"hasCode":!self.code.is_empty(),
            "activatedAt":result["activated_at"],"expiresAt":result["expires_at"]
        });
        let _ = app.emit_to(
            "main",
            "assistant:event",
            json!({"type":"license","state":self.state}),
        );
        self.state.clone()
    }

    async fn verify(&mut self, app: &AppHandle) -> Value {
        let result = if self.code.is_empty() {
            json!({"valid":false,"reason":"not_activated"})
        } else {
            self.call("verify", &self.code).await
        };
        self.publish(app, result)
    }
}

pub async fn require_valid(app: &AppHandle) -> Result<(), String> {
    let service = app.state::<License>();
    let result = service.0.lock().await.verify(app).await;
    if result["valid"] == true {
        Ok(())
    } else {
        Err(result["message"].as_str().unwrap_or("授权无效").into())
    }
}

#[tauri::command]
pub async fn license_state(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    let service = app.state::<License>();
    let state = service.0.lock().await.state.clone();
    Ok(state)
}

#[tauri::command]
pub async fn license_verify(app: AppHandle, webview: Webview) -> Result<Value, String> {
    crate::require_main(&webview)?;
    let service = app.state::<License>();
    let state = service.0.lock().await.verify(&app).await;
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
    let mut license = service.0.lock().await;
    let result = if code.len() == 24
        && code
            .chars()
            .all(|c| "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(c))
    {
        license.call("activate", &code).await
    } else {
        json!({"valid":false,"reason":"invalid_license"})
    };
    if result["valid"] != true {
        let response = json!({"valid":false,"message":message(result["reason"].as_str().unwrap_or("invalid_license"))});
        if license.state["valid"] != true {
            license.publish(&app, result);
        }
        return Ok(response);
    }
    crate::storage::write_json(
        &license.file,
        &json!({"deviceId": license.state["deviceId"], "code": code}),
    )
    .map_err(|e| e.to_string())?;
    license.code = code;
    license.publish(&app, result);
    Ok(json!({"valid":true}))
}
