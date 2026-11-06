// CI-only executable: uses the production updater against Gitee, never installs.
#[allow(dead_code)]
#[path = "../src/update.rs"]
mod update;

use std::{collections::HashSet, sync::Mutex};
use tauri::Manager;

#[derive(Default)]
pub struct Tasks(pub Mutex<HashSet<String>>);
fn require_main(view: &tauri::Webview) -> Result<(), String> {
    if view.label() == "main" { Ok(()) } else { Err("main only".into()) }
}
mod browser {
    pub async fn flush_sessions(_: &tauri::AppHandle) -> Result<(), String> {
        Err("下载验证不执行安装".into())
    }
}
fn main() {
    let profile = std::path::PathBuf::from(std::env::var("ASSISTANT_TEST_DATA").expect("isolated directory required"));
    std::fs::create_dir_all(&profile).unwrap();
    let version = std::env::var("UPDATE_CURRENT_VERSION").expect("current version required");
    let mut context = tauri::generate_context!();
    context.package_info_mut().version = semver::Version::parse(&version).unwrap();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::Updates::new(&version))
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External("about:blank".parse().unwrap()))
                .visible(false).data_directory(profile.join("webview")).build()?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let checked = update::check(&handle).await;
                let result = if checked["status"] == "available" {
                    update::update_download(handle.clone(), handle.get_webview("main").unwrap()).await
                        .unwrap_or_else(|e| serde_json::json!({"status":"error","error":e}))
                } else { checked };
                let passed = result["status"] == "downloaded";
                let report = serde_json::json!({"platform":std::env::consts::OS,"source":"production update.rs","downloadSignatureVerified":passed,"installed":false,"state":result});
                std::fs::write(profile.join("result.json"), serde_json::to_vec_pretty(&report).unwrap()).unwrap();
                println!("{report}");
                handle.exit(if passed { 0 } else { 1 });
            });
            Ok(())
        })
        .run(context).expect("Windows updater check failed");
}
