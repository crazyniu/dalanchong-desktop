//! AI module map
//! Purpose: turn one SHA-256-verified upstream archive into the dedicated browser.
//! Entry: chrome_runtime::executable owns staging and calls prepare or reuse before publication.
//! Flow: macOS mounts its DMG read-only, preserves the complete app with ditto,
//! applies our bundle identity/icon/localized names, and signs leaves before containers.
//! Windows extracts the complete official ZIP with the system PowerShell tool and
//! replaces the native application/window icons in chrome.exe and chrome.dll.
//! reuse copies a completed identical-version local engine and reapplies branding
//! without changing the source bundle, running browsers or browser account profiles.
//! Invariants: all mutations stay in private installation staging; retain upstream
//! credits/resources, detach mounted volumes on failure, and never access profiles.
//! macOS ad-hoc signing has no Team ID, so hardened library validation is disabled.

use std::{fs, io::Write, path::{Path, PathBuf}, process::{Command, Stdio}};

use super::{Download, Engine};

#[cfg(target_os = "windows")]
#[path = "chrome_runtime_icon.rs"]
mod icon;

fn run(command: &mut Command) -> Result<Vec<u8>, String> {
    let output = command.output().map_err(|e| format!("安装专用浏览器失败：{e}"))?;
    if !output.status.success() {
        return Err(format!("安装专用浏览器失败：{}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    Ok(output.stdout)
}

#[cfg(target_os = "macos")]
fn plist(bytes: &[u8]) -> Result<serde_json::Value, String> {
    let mut command = Command::new("/usr/bin/plutil");
    command.args(["-convert", "json", "-o", "-", "-"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("读取浏览器应用信息失败：{e}"))?;
    child.stdin.take().unwrap().write_all(bytes).map_err(|e| format!("读取浏览器应用信息失败：{e}"))?;
    let output = child.wait_with_output().map_err(|e| format!("读取浏览器应用信息失败：{e}"))?;
    if !output.status.success() { return Err(format!("读取浏览器应用信息失败：{}", String::from_utf8_lossy(&output.stderr).trim())); }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("读取浏览器应用信息失败：{e}"))
}

#[cfg(target_os = "macos")]
fn write_plist(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let mut command = Command::new("/usr/bin/plutil");
    command.args(["-convert", "xml1", "-o"]).arg(path).arg("-")
        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("设置浏览器应用信息失败：{e}"))?;
    child.stdin.take().unwrap().write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| format!("设置浏览器应用信息失败：{e}"))?;
    let output = child.wait_with_output().map_err(|e| format!("设置浏览器应用信息失败：{e}"))?;
    if !output.status.success() { return Err(format!("设置浏览器应用信息失败：{}", String::from_utf8_lossy(&output.stderr).trim())); }
    Ok(())
}

#[cfg(target_os = "macos")]
fn brand_mac(app: &Path, temporary: &Path, engine: &Engine, download: &Download) -> Result<(), String> {
    let info = app.join("Contents/Info.plist");
    let mut metadata = plist(&fs::read(&info).map_err(|e| e.to_string())?)?;
    if metadata["CFBundleShortVersionString"] != download.version { return Err("专用浏览器版本与下载配置不一致".into()); }
    metadata["CFBundleIdentifier"] = engine.bundle_identifier.clone().into();
    metadata["CFBundleName"] = engine.display_name.clone().into();
    metadata["CFBundleDisplayName"] = engine.display_name.clone().into();
    metadata["CFBundleExecutable"] = "Chromium".into();
    metadata["CFBundleIconFile"] = "app.icns".into();
    metadata.as_object_mut().ok_or("浏览器应用信息格式无效")?.remove("CFBundleIconName");
    write_plist(&info, &metadata)?;
    let resources = app.join("Contents/Resources");
    fs::write(resources.join("app.icns"), include_bytes!("../../assets/icons/app.icns"))
        .map_err(|e| format!("设置浏览器图标失败：{e}"))?;
    fs::write(resources.join("LICENSE.ungoogled-chromium"), include_bytes!("../../browser-runtime/LICENSE.ungoogled-chromium"))
        .map_err(|e| e.to_string())?;
    for entry in fs::read_dir(&resources).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir()
            || entry.path().extension().and_then(|value| value.to_str()) != Some("lproj") { continue; }
        let strings = entry.path().join("InfoPlist.strings");
        if !strings.is_file() { continue; }
        let mut localized = plist(&fs::read(&strings).map_err(|e| e.to_string())?)?;
        localized["CFBundleName"] = engine.display_name.clone().into();
        localized["CFBundleDisplayName"] = engine.display_name.clone().into();
        localized["CFBundleIconFile"] = "app.icns".into();
        localized.as_object_mut().ok_or("浏览器本地化应用信息格式无效")?.remove("CFBundleIconName");
        write_plist(&strings, &localized)?;
    }
    run(Command::new("/usr/bin/xattr").arg("-cr").arg(app))?;
    sign_mac(app, temporary, &engine.bundle_identifier)
}

#[cfg(target_os = "macos")]
fn sign_mac(app: &Path, temporary: &Path, identifier: &str) -> Result<(), String> {
    use std::io::Read;

    fn collect(directory: &Path, binaries: &mut Vec<PathBuf>, bundles: &mut Vec<PathBuf>) -> Result<(), String> {
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            let path = entry.path();
            if kind.is_symlink() { continue; }
            if kind.is_dir() {
                collect(&path, binaries, bundles)?;
                if matches!(path.extension().and_then(|ext| ext.to_str()), Some("app" | "framework")) { bundles.push(path); }
            } else if kind.is_file() {
                let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
                let mut magic = [0; 4];
                let count = file.read(&mut magic).map_err(|e| e.to_string())?;
                if count == 4 && matches!(u32::from_be_bytes(magic),
                    0xfeedface | 0xcefaedfe | 0xfeedfacf | 0xcffaedfe | 0xcafebabe | 0xbebafeca | 0xcafebabf | 0xbfbafeca)
                { binaries.push(path); }
            }
        }
        Ok(())
    }

    let entitlements = temporary.join("browser-entitlements.plist");
    fs::write(&entitlements, include_bytes!("../../browser-runtime/entitlements.plist")).map_err(|e| e.to_string())?;
    let mut binaries = Vec::new();
    let mut bundles = Vec::new();
    collect(app, &mut binaries, &mut bundles)?;
    let sign = |path: &Path, jit: bool| -> Result<(), String> {
        let mut command = Command::new("/usr/bin/codesign");
        command.args(["--force", "--sign", "-", "--options", "0", "--timestamp=none"]);
        if path == app.join("Contents/MacOS/Chromium") { command.args(["--identifier", identifier]); }
        if jit { command.arg("--entitlements").arg(&entitlements); }
        run(command.arg(path))?;
        Ok(())
    };
    for path in binaries { sign(&path, false)?; }
    // collect appends containers after their children, preserving inside-out signing.
    for path in bundles {
        let jit = matches!(path.file_name().and_then(|name| name.to_str()),
            Some("Chromium Helper (Renderer).app" | "Chromium Helper (GPU).app"));
        sign(&path, jit)?;
    }
    sign(app, false)
}

#[cfg(target_os = "macos")]
pub(super) fn reuse(source: &Path, destination: &Path, temporary: &Path, engine: &Engine, download: &Download) -> Result<(), String> {
    let source = [super::MAC_APP_BUNDLE, "DalanchongBrowser.app"].into_iter()
        .map(|bundle| source.join(bundle))
        .find(|bundle| bundle.join("Contents/MacOS/Chromium").is_file())
        .ok_or("已安装浏览器缺少主程序")?;
    let app = destination.join(super::MAC_APP_BUNDLE);
    run(Command::new("/usr/bin/ditto").arg(source).arg(&app))?;
    brand_mac(&app, temporary, engine, download)
}

#[cfg(target_os = "macos")]
pub(super) fn prepare(archive: &Path, destination: &Path, temporary: &Path, engine: &Engine, download: &Download) -> Result<(), String> {
    // An owned mount point remains available for cleanup even if parsing the
    // successful hdiutil response fails before its volumes can be enumerated.
    let mount = temporary.join("mounted");
    fs::create_dir(&mount).map_err(|e| format!("创建浏览器镜像挂载目录失败：{e}"))?;
    let attached = run(Command::new("/usr/bin/hdiutil").args(["attach", "-readonly", "-nobrowse", "-plist", "-mountpoint"])
        .arg(&mount).arg(archive))?;
    let result = (|| {
        let mounted = plist(&attached)?;
        let volumes = mounted["system-entities"].as_array().ok_or("浏览器镜像挂载信息无效")?.iter()
            .filter_map(|item| item["mount-point"].as_str().map(PathBuf::from)).collect::<Vec<_>>();
        let mut apps = Vec::new();
        for volume in &volumes {
            for entry in fs::read_dir(volume).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                if entry.file_type().map_err(|e| e.to_string())?.is_dir()
                    && entry.path().extension().and_then(|value| value.to_str()) == Some("app") { apps.push(entry.path()); }
            }
        }
        if apps.len() != 1 { return Err("浏览器镜像中未找到唯一应用".into()); }
        // Keep the physical bundle name Chinese as well as its plist display names.
        let app = destination.join(super::MAC_APP_BUNDLE);
        run(Command::new("/usr/bin/ditto").arg(&apps[0]).arg(&app))?;
        brand_mac(&app, temporary, engine, download)
    })();
    let detached = run(Command::new("/usr/bin/hdiutil").arg("detach").arg(&mount));
    result?;
    detached?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub(super) fn prepare(archive: &Path, destination: &Path, temporary: &Path, _engine: &Engine, _download: &Download) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    fn find_browser(directory: &Path, binaries: &mut Vec<PathBuf>, resource_dlls: &mut Vec<PathBuf>) -> Result<(), String> {
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_dir() { find_browser(&entry.path(), binaries, resource_dlls)?; }
            else if entry.file_name() == "chrome.exe" { binaries.push(entry.path()); }
            else if entry.file_name() == "chrome.dll" { resource_dlls.push(entry.path()); }
        }
        Ok(())
    }

    let extracted = temporary.join("extracted");
    run(Command::new("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command",
        "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:DALANCHONG_BROWSER_ARCHIVE -DestinationPath $env:DALANCHONG_BROWSER_DESTINATION"])
        .env("DALANCHONG_BROWSER_ARCHIVE", archive).env("DALANCHONG_BROWSER_DESTINATION", &extracted)
        .creation_flags(0x08000000))?;
    let mut binaries = Vec::new();
    let mut resource_dlls = Vec::new();
    find_browser(&extracted, &mut binaries, &mut resource_dlls)?;
    if binaries.len() != 1 { return Err("浏览器压缩包中未找到唯一主程序".into()); }
    if resource_dlls.len() != 1 { return Err("浏览器压缩包中未找到唯一窗口资源".into()); }
    // Chromium loads the Explorer icon from the EXE and window icons from its
    // resources DLL. Update both main groups without changing document icons.
    icon::replace_exe(&binaries[0])?;
    icon::replace_dll(&resource_dlls[0])?;
    let browser = destination.join("WindowsBrowser");
    fs::rename(binaries[0].parent().unwrap(), &browser).map_err(|e| format!("安装浏览器资源失败：{e}"))?;
    fs::write(browser.join("LICENSE.ungoogled-chromium"), include_bytes!("../../browser-runtime/LICENSE.ungoogled-chromium"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub(super) fn reuse(source: &Path, destination: &Path, _temporary: &Path, _engine: &Engine, _download: &Download) -> Result<(), String> {
    fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
        fs::create_dir(destination).map_err(|e| format!("复制已安装浏览器失败：{e}"))?;
        for entry in fs::read_dir(source).map_err(|e| format!("复制已安装浏览器失败：{e}"))? {
            let entry = entry.map_err(|e| format!("复制已安装浏览器失败：{e}"))?;
            let target = destination.join(entry.file_name());
            if entry.file_type().map_err(|e| format!("复制已安装浏览器失败：{e}"))?.is_dir() {
                copy_directory(&entry.path(), &target)?;
            } else {
                fs::copy(entry.path(), target).map_err(|e| format!("复制已安装浏览器失败：{e}"))?;
            }
        }
        Ok(())
    }

    fn resource_dll(directory: &Path, found: &mut Vec<PathBuf>) -> Result<(), String> {
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_dir() { resource_dll(&entry.path(), found)?; }
            else if entry.file_name() == "chrome.dll" { found.push(entry.path()); }
        }
        Ok(())
    }

    let browser = destination.join("WindowsBrowser");
    copy_directory(&source.join("WindowsBrowser"), &browser)?;
    let mut dlls = Vec::new();
    resource_dll(&browser, &mut dlls)?;
    if dlls.len() != 1 { return Err("已安装浏览器中未找到唯一窗口资源".into()); }
    icon::replace_exe(&browser.join("chrome.exe"))?;
    icon::replace_dll(&dlls[0])?;
    fs::write(browser.join("LICENSE.ungoogled-chromium"), include_bytes!("../../browser-runtime/LICENSE.ungoogled-chromium"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(super) fn reuse(_source: &Path, _destination: &Path, _temporary: &Path, _engine: &Engine, _download: &Download) -> Result<(), String> {
    Err("当前系统不支持专用浏览器".into())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(super) fn prepare(_archive: &Path, _destination: &Path, _temporary: &Path, _engine: &Engine, _download: &Download) -> Result<(), String> {
    Err("当前系统不支持专用浏览器".into())
}
