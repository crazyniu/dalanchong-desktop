//! AI module map
//! Purpose: supply this project's video extension to isolated dedicated Chromium accounts.
//! Entry: chrome::open calls prepare and pin under its operation lock before a cold launch.
//! Flow: development reads the maintained extension directory directly; packaged builds
//! copy the bundled, minified runtime into a stable app-data path when its fingerprint changes.
//! scripts/prepare-video-extension.mjs owns that fingerprint and the bundled resource names.
//! fingerprint identifies the source loaded in each browser; changed source must reload
//! the existing extension instead of mixing new content scripts with an old worker.
//! Ownership: this directory contains replaceable extension code only. Chrome owns each
//! account's extension history and tasks inside its separate chromium-profiles profile.
//! pin enables developer mode for the app-owned unpacked extension, and merges the
//! toolbar ID and bookmark-bar visibility into closed-profile Preferences;
//! it returns the video-list URL for chrome.rs to add to the account's bookmarks.
//! The bookmark opens the extension's Douyin video manager.
//! Invariants: keep the installed path stable because this manifest has no public key.
//! chrome.rs loads this path through Chrome's browser-level Extensions API after startup.
//! Preserve all other profile values, and never write Preferences while Chrome is running.
//! Do not rewrite extension business logic or restart existing browsers.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

#[cfg(debug_assertions)]
pub fn prepare(_app: &AppHandle) -> Result<PathBuf, String> {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../browser-extension");
    fs::metadata(directory.join("manifest.json"))
        .map_err(|e| format!("读取视频插件失败（{}）：{e}", directory.display()))?;
    directory.canonicalize().map_err(|e| e.to_string())
}

#[cfg(not(debug_assertions))]
pub fn prepare(app: &AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let fingerprint = fs::read(resources.join("video-extension.sha256"))
        .map_err(|e| format!("读取视频插件资源失败：{e}"))?;
    let directory = crate::data_dir(app).join("browser-extensions/video-downloader");
    let marker = directory.join(".bundle-sha256");
    if directory.join("manifest.json").is_file()
        && fs::read(&marker).ok().as_deref() == Some(fingerprint.as_slice())
    {
        return Ok(directory);
    }
    // Only generated code is replaced. Account-scoped extension storage stays in Chromium.
    if directory.exists() {
        fs::remove_dir_all(&directory).map_err(|e| format!("更新视频插件失败：{e}"))?;
    }
    copy_directory(&resources.join("video-extension"), &directory)
        .map_err(|e| format!("安装视频插件失败：{e}"))?;
    fs::write(marker, fingerprint).map_err(|e| e.to_string())?;
    Ok(directory)
}

/// Release resources already carry a content hash. Development reads executable
/// extension resources so edits are detected even when the app version is unchanged.
pub fn fingerprint(extension: &Path) -> Result<String, String> {
    #[cfg(not(debug_assertions))]
    return fs::read_to_string(extension.join(".bundle-sha256")).map_err(|e| e.to_string());
    #[cfg(debug_assertions)]
    {
        fn hash_directory(directory: &Path, hash: &mut Sha256) -> std::io::Result<()> {
            use std::io::Read;
            let mut entries = fs::read_dir(directory)?.collect::<Result<Vec<_>, _>>()?;
            entries.sort_by_key(|entry| entry.file_name());
            for entry in entries {
                let name = entry.file_name();
                if name.to_string_lossy().starts_with('.') { continue; }
                let path = entry.path();
                if entry.file_type()?.is_dir() {
                    hash.update(name.to_string_lossy().as_bytes());
                    hash.update(b"/");
                    hash_directory(&path, hash)?;
                    hash.update(b"\0");
                } else if matches!(path.extension().and_then(|ext| ext.to_str()),
                    Some("js" | "json" | "html" | "css" | "wasm")) {
                    hash.update(name.to_string_lossy().as_bytes());
                    hash.update(b"\0");
                    let mut file = fs::File::open(path)?;
                    let mut buffer = [0u8; 65536];
                    loop {
                        let count = file.read(&mut buffer)?;
                        if count == 0 { break; }
                        hash.update(&buffer[..count]);
                    }
                    hash.update(b"\0");
                }
            }
            Ok(())
        }
        let mut hash = Sha256::new();
        hash_directory(extension, &mut hash).map_err(|e| e.to_string())?;
        Ok(format!("{:x}", hash.finalize()))
    }
}

/// The caller owns the cold-launch lock and has already created Default/Preferences.
/// Enable unpacked extensions in this managed profile and retain existing toolbar pins.
/// This never changes developer mode in the user's personal Chrome profile.
pub fn pin(profile: &Path, extension: &Path) -> Result<String, String> {
    let id = extension_id(extension)?;
    let home_url = format!("chrome-extension://{id}/manager.html#videos");
    let path = profile.join("Default/Preferences");
    let mut preferences: Value =
        serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let root = preferences.as_object_mut().ok_or("浏览器配置格式无效")?;
    let mut changed = false;
    // Chromium's extensions/browser/pref_names.h stores IDs in this Preferences list.
    let extensions = root
        .entry("extensions")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("浏览器扩展配置格式无效")?;
    let pinned = extensions
        .entry("pinned_extensions")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or("浏览器固定扩展配置格式无效")?;
    if !pinned.iter().any(|entry| entry.as_str() == Some(id.as_str())) {
        pinned.push(Value::String(id));
        changed = true;
    }
    let ui = extensions.entry("ui").or_insert_with(|| json!({}))
        .as_object_mut().ok_or("浏览器扩展界面配置格式无效")?;
    if ui.get("developer_mode") != Some(&Value::Bool(true)) {
        ui.insert("developer_mode".into(), json!(true));
        changed = true;
    }
    let bookmark_bar = root
        .entry("bookmark_bar")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("浏览器书签栏配置格式无效")?;
    if bookmark_bar.get("show_on_all_tabs") != Some(&Value::Bool(true)) {
        bookmark_bar.insert("show_on_all_tabs".into(), Value::Bool(true));
        changed = true;
    }
    if changed {
        crate::storage::write_json(&path, &preferences).map_err(|e| e.to_string())?;
    }
    Ok(home_url)
}

pub(crate) fn extension_id(extension: &Path) -> Result<String, String> {
    // Match Chromium components/crx_file/id_util.cc: SHA-256 native path bytes,
    // retain 16 bytes, then encode each hexadecimal nibble using the a-p alphabet.
    let hash = Sha256::digest(extension_path_bytes(extension)?);
    let mut id = String::with_capacity(32);
    for byte in &hash[..16] {
        id.push(char::from(b'a' + (byte >> 4)));
        id.push(char::from(b'a' + (byte & 15)));
    }
    Ok(id)
}

#[cfg(unix)]
fn extension_path_bytes(extension: &Path) -> Result<Vec<u8>, String> {
    use std::os::unix::ffi::OsStrExt;

    // UnpackedInstaller::LoadFromCommandLine uses MakeAbsoluteFilePath (realpath).
    let absolute = extension.canonicalize().map_err(|e| e.to_string())?;
    Ok(absolute.as_os_str().as_bytes().to_vec())
}

#[cfg(windows)]
fn extension_path_bytes(extension: &Path) -> Result<Vec<u8>, String> {
    use std::os::windows::ffi::OsStrExt;

    unsafe extern "C" {
        fn _wfullpath(absolute: *mut u16, relative: *const u16, length: usize) -> *mut u16;
    }

    // Match base/files/file_util_win.cc, including its MAX_PATH limit and handling
    // of verbatim paths. Do not use canonicalize: it adds a different path prefix.
    let input: Vec<u16> = extension.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut absolute = [0u16; 260];
    // SAFETY: input is NUL-terminated; the writable buffer contains length u16 units.
    // The CRT writes only inside that buffer, returns NUL-terminated data on success,
    // and does not allocate or transfer ownership when the output pointer is supplied.
    if unsafe { _wfullpath(absolute.as_mut_ptr(), input.as_ptr(), absolute.len()) }.is_null() {
        return Err("无法解析视频插件路径".into());
    }
    // MaybeNormalizePath uppercases only an ASCII drive letter. Windows FilePath
    // stores UTF-16LE, so hash code-unit bytes without UTF-8 conversion or a terminator.
    if (b'a' as u16..=b'z' as u16).contains(&absolute[0]) && absolute[1] == b':' as u16 {
        absolute[0] -= (b'a' - b'A') as u16;
    }
    Ok(absolute
        .iter()
        .copied()
        .take_while(|unit| *unit != 0)
        .flat_map(u16::to_le_bytes)
        .collect())
}

#[cfg(not(debug_assertions))]
fn copy_directory(source: &std::path::Path, destination: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
