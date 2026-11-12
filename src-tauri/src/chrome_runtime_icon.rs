//! AI module map
//! Purpose: replace the staged Windows browser's native file and window icon resources.
//! Entry: chrome_runtime_install.rs calls replace_exe and replace_dll before publication.
//! Flow: parse the embedded ICO, enumerate existing icon group names/languages through
//! a data-only module mapping, close that mapping, then update the original main group in
//! one resource transaction. New image IDs follow the file's existing RT_ICON IDs.
//! Ownership: only staging chrome.exe and chrome.dll are modified. The EXE's named
//! IDR_MAINFRAME owns its file icon; chrome.dll group 101 supplies Chromium's window icon.
//! PDF, incognito and other icon groups/images and non-icon resources remain intact.
//! No browser/profile or DLL code is loaded; original names/languages stay authoritative.

use std::{io, os::windows::ffi::OsStrExt, path::Path, ptr, slice};

use windows_sys::{
    core::{BOOL, PCWSTR},
    Win32::{
        Foundation::{FreeLibrary, HANDLE, HMODULE},
        System::LibraryLoader::{BeginUpdateResourceW, EndUpdateResourceW,
            EnumResourceLanguagesW, EnumResourceNamesW, LoadLibraryExW,
            UpdateResourceW, LOAD_LIBRARY_AS_DATAFILE_EXCLUSIVE},
        UI::WindowsAndMessaging::{RT_GROUP_ICON, RT_ICON},
    },
};

#[derive(PartialEq)]
enum ResourceName {
    Id(u16),
    Text(Vec<u16>),
}

impl ResourceName {
    fn pointer(&self) -> PCWSTR {
        match self {
            Self::Id(id) => *id as usize as PCWSTR,
            Self::Text(text) => text.as_ptr(),
        }
    }
}

#[derive(Default)]
struct Names {
    values: Vec<ResourceName>,
    allocation_failed: bool,
}

#[derive(Default)]
struct Languages {
    values: Vec<u16>,
    allocation_failed: bool,
}

struct Group {
    name: ResourceName,
    languages: Vec<u16>,
}

struct Frame<'a> {
    directory: &'a [u8],
    image: &'a [u8],
}

fn frames(bytes: &[u8]) -> Result<Vec<Frame<'_>>, String> {
    let invalid = "浏览器图标 ICO 数据格式无效";
    if !bytes.starts_with(&[0, 0, 1, 0]) { return Err(invalid.into()); }
    let count = bytes.get(4..6).ok_or(invalid)?;
    let count = u16::from_le_bytes([count[0], count[1]]) as usize;
    if count == 0 { return Err(invalid.into()); }
    let directory = bytes.get(6..6 + count * 16).ok_or(invalid)?;
    let mut result = Vec::with_capacity(count);
    // ICONDIR entries are 16 bytes: dimensions/colors, planes/bpp, image length
    // and absolute ICO image offset. Their resource equivalent replaces offset by ID.
    for entry in directory.chunks_exact(16) {
        let length = u32::from_le_bytes([entry[8], entry[9], entry[10], entry[11]]) as usize;
        let offset = u32::from_le_bytes([entry[12], entry[13], entry[14], entry[15]]) as usize;
        let end = offset.checked_add(length).ok_or(invalid)?;
        let image = bytes.get(offset..end).ok_or(invalid)?;
        if image.is_empty() { return Err(invalid.into()); }
        result.push(Frame { directory: &entry[..12], image });
    }
    Ok(result)
}

unsafe extern "system" fn icon_id(_module: HMODULE, _kind: PCWSTR, name: PCWSTR, parameter: isize) -> BOOL {
    // SAFETY: enumeration synchronously receives the caller's live u16 pointer.
    // Integer resource names use the low 16 bits and are never dereferenced.
    let maximum = unsafe { &mut *(parameter as *mut u16) };
    if name as usize <= u16::MAX as usize { *maximum = (*maximum).max(name as usize as u16); }
    1
}

unsafe extern "system" fn group_name(_module: HMODULE, _kind: PCWSTR, name: PCWSTR, parameter: isize) -> BOOL {
    // SAFETY: parameter is a live Names for this synchronous enumeration. Win32
    // supplies either an integer name or a valid NUL-terminated UTF-16 string.
    let names = unsafe { &mut *(parameter as *mut Names) };
    if names.values.try_reserve(1).is_err() { names.allocation_failed = true; return 0; }
    let name = if name as usize <= u16::MAX as usize {
        ResourceName::Id(name as usize as u16)
    } else {
        let mut length = 0;
        // SAFETY: the API-owned name remains valid until this callback returns.
        while unsafe { *name.add(length) } != 0 { length += 1; }
        let mut text = Vec::new();
        if text.try_reserve_exact(length + 1).is_err() { names.allocation_failed = true; return 0; }
        // SAFETY: copy the terminator too; the owned buffer outlives the module.
        text.extend_from_slice(unsafe { slice::from_raw_parts(name, length + 1) });
        ResourceName::Text(text)
    };
    names.values.push(name);
    1
}

unsafe extern "system" fn group_language(_module: HMODULE, _kind: PCWSTR, _name: PCWSTR,
    language: u16, parameter: isize,
) -> BOOL {
    // SAFETY: parameter is the caller's live Languages for synchronous enumeration.
    // Reserving fallibly keeps allocation failure from unwinding through Win32.
    let languages = unsafe { &mut *(parameter as *mut Languages) };
    if languages.values.try_reserve(1).is_err() { languages.allocation_failed = true; return 0; }
    languages.values.push(language);
    1
}

fn error(action: &str) -> String { format!("{action}：{}", io::Error::last_os_error()) }

fn inventory(module: HMODULE, target: &ResourceName) -> Result<(Group, u16), String> {
    let mut maximum = 0u16;
    let mut names = Names::default();
    // SAFETY: the data-only module is live. Both callbacks only copy metadata into
    // stack contexts whose lifetime covers the synchronous API calls.
    if unsafe { EnumResourceNamesW(module, RT_ICON, Some(icon_id), &mut maximum as *mut u16 as isize) } == 0 {
        return Err(error("读取浏览器图标编号失败"));
    }
    // SAFETY: names remains valid and exclusively borrowed by the callback.
    if unsafe { EnumResourceNamesW(module, RT_GROUP_ICON, Some(group_name), &mut names as *mut Names as isize) } == 0 {
        if names.allocation_failed { return Err("读取浏览器图标组时内存不足".into()); }
        return Err(error("读取浏览器图标组失败"));
    }
    let name = names.values.into_iter().find(|name| name == target)
        .ok_or("浏览器程序缺少主窗口图标组")?;
    let mut languages = Languages::default();
    // SAFETY: the owned name is NUL-terminated or an integer resource ID;
    // language callbacks complete before the stack context can be dropped.
    if unsafe { EnumResourceLanguagesW(module, RT_GROUP_ICON, name.pointer(), Some(group_language),
        &mut languages as *mut Languages as isize) } == 0
    {
        if languages.allocation_failed { return Err("读取浏览器图标语言时内存不足".into()); }
        return Err(error("读取浏览器图标语言失败"));
    }
    Ok((Group { name, languages: languages.values }, maximum))
}

fn update(handle: HANDLE, kind: PCWSTR, name: PCWSTR, language: u16, bytes: &[u8]) -> Result<(), String> {
    // SAFETY: handle is an open update transaction. Resource names are integer IDs
    // or live owned UTF-16 buffers. ICO image lengths originate in u32 fields and
    // group data is below 1 MiB; the immutable data stays live during this call.
    if unsafe { UpdateResourceW(handle, kind, name, language, bytes.as_ptr().cast(), bytes.len() as u32) } == 0 {
        return Err(error("写入浏览器原生图标失败"));
    }
    Ok(())
}

// Chromium's chrome_exe.rc leaves this symbol as a named resource, while
// chrome_dll_resource.h assigns its independent window-icon group the ID 101.
// https://github.com/chromium/chromium/blob/main/chrome/app/chrome_exe.rc
// https://github.com/chromium/chromium/blob/main/chrome/app/chrome_dll_resource.h
pub(super) fn replace_exe(path: &Path) -> Result<(), String> {
    let name = "IDR_MAINFRAME".encode_utf16().chain(std::iter::once(0)).collect();
    replace(path, ResourceName::Text(name))
}

pub(super) fn replace_dll(path: &Path) -> Result<(), String> {
    replace(path, ResourceName::Id(101))
}

fn replace(path: &Path, target: ResourceName) -> Result<(), String> {
    let frames = frames(include_bytes!("../../assets/icons/app.ico"))?;
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    // SAFETY: this is an owned staging file and wide is a valid UTF-16 path.
    // DATAFILE_EXCLUSIVE maps resources without executing code or resolving imports.
    let module = unsafe { LoadLibraryExW(wide.as_ptr(), ptr::null_mut(), LOAD_LIBRARY_AS_DATAFILE_EXCLUSIVE) };
    if module.is_null() { return Err(error("打开浏览器图标资源失败")); }
    let resources = inventory(module, &target);
    // SAFETY: release our only data mapping before opening the same file for edits.
    let closed = unsafe { FreeLibrary(module) };
    let (group, maximum) = resources?;
    if closed == 0 { return Err(error("关闭浏览器图标资源失败")); }
    let count = frames.len() as u16;
    maximum.checked_add(count).ok_or("浏览器图标资源编号已用尽")?;
    let mut directory = vec![0, 0, 1, 0];
    directory.extend_from_slice(&count.to_le_bytes());
    for (index, frame) in frames.iter().enumerate() {
        directory.extend_from_slice(frame.directory);
        directory.extend_from_slice(&(maximum + index as u16 + 1).to_le_bytes());
    }
    // SAFETY: false retains all existing resources. Every failure before commit is
    // discarded below; no module mapping or browser can hold this private file open.
    let transaction = unsafe { BeginUpdateResourceW(wide.as_ptr(), 0) };
    if transaction.is_null() { return Err(error("创建浏览器图标事务失败")); }
    let result = (|| {
        for &language in &group.languages {
            for (index, frame) in frames.iter().enumerate() {
                let id = (maximum + index as u16 + 1) as usize as PCWSTR;
                update(transaction, RT_ICON, id, language, frame.image)?;
            }
        }
        for &language in &group.languages {
            update(transaction, RT_GROUP_ICON, group.name.pointer(), language, &directory)?;
        }
        Ok::<_, String>(())
    })();
    // SAFETY: this consumes the single update handle exactly once. A failed write
    // discards every queued resource edit; success replaces only the main group.
    let committed = unsafe { EndUpdateResourceW(transaction, i32::from(result.is_err())) };
    result?;
    if committed == 0 { return Err(error("提交浏览器原生图标失败")); }
    Ok(())
}
