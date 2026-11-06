fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "overlay_ready",
            "overlay_sync",
            "overlay_resize",
            "toolbar_ready",
            "toolbar_sync",
            "toolbar_resize",
            "toolbar_action",
            "license_state",
            "license_verify",
            "license_activate",
            "runtime_load",
            "runtime_save",
            "diagnostic_append",
            "diagnostic_export",
            "set_task_state",
            "update_state",
            "update_check",
            "update_download",
            "update_install",
            "browser_prepare",
            "browser_show",
            "browser_hide",
            "browser_navigate",
            "browser_login",
            "browser_finish_login",
            "browser_remove",
            "platform_eval",
            "platform_result",
            "platform_observe",
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
