//! AI module map
//! Purpose: register the app-owned command permission names consumed by Tauri's build step.
//! Entry: Cargo invokes main(); tauri_build generates the platform context and ACL metadata.
//! Flow: AppManifest lists native commands whose allow-* permissions are granted selectively
//! by capabilities/*.json and whose handlers are registered in src/lib.rs.
//! Invariant: adding a handler alone is insufficient; synchronize all three locations and
//! never grant main-only commands to remote platform or auxiliary overlay WebViews.

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "overlay_ready",
            "overlay_sync",
            "overlay_resize",
            "overlay_action",
            "toolbar_ready",
            "toolbar_sync",
            "toolbar_resize",
            "toolbar_move",
            "toolbar_action",
            "license_state",
            "license_activate",
            "runtime_load",
            "runtime_save",
            "database_query",
            "database_delete",
            "database_export",
            "export_csv",
            "diagnostic_append",
            "diagnostic_export",
            "diagnostic_clear",
            "set_task_state",
            "update_state",
            "update_check",
            "update_download",
            "update_install",
            "browser_prepare",
            "browser_show",
            "browser_hide",
            "browser_snapshot",
            "browser_navigate",
            "browser_history",
            "browser_open_external",
            "browser_login",
            "browser_finish_login",
            "browser_remove",
            "platform_eval",
            "platform_result",
            "platform_observe",
            "platform_route",
            "chrome_accounts",
            "chrome_save_account",
            "chrome_open",
            "chrome_remove_account",
        ]),
    ))
    .expect("Tauri 权限构建失败");
    // tauri-build links the Windows manifest only into the app binary.
    // The CI updater executable also needs Common Controls v6 to start.
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows" {
        let resource = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("resource.lib");
        println!("cargo:rustc-link-arg-examples={}", resource.display());
    }
}
