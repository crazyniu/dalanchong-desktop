//! AI module map
//! Purpose: recover the actual macOS Dalanchong Chromium process owning one shop profile.
//! Entry: chrome.rs calls running before reusing, launching or closing that shop.
//! Flow: SingletonLock supplies a candidate PID; KERN_PROCARGS2 supplies its saved
//! executable path and argv. Match the dedicated browser's main process, canonical user-data-dir
//! and debugging port before returning ownership to chrome.rs. Port-zero Chromium
//! processes supply their assigned port through that profile's DevToolsActivePort.
//! A returned port of zero means that live owner has not written its assigned port yet.
//! Boundary: read-only filesystem/sysctl calls; never spawn commands, signal a
//! process, rewrite a profile or expose argv/environment in errors or logs.
//! State: no cache. A missing lock or exited PID means None; an unreadable or
//! mismatched live process is an error so callers cannot launch over its profile.
//! Related: chrome.rs owns CDP verification, endpoint persistence and shutdown.

use std::{
    ffi::{c_int, c_uint, c_void, OsStr},
    fs,
    io::{self, ErrorKind},
    mem::size_of,
    os::unix::ffi::OsStrExt,
    path::Path,
    ptr,
};

// Apple's bsd/sys/sysctl.h defines these MIB identifiers.
// https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/sysctl.h
const CTL_KERN: c_int = 1;
const KERN_ARGMAX: c_int = 8;
const KERN_PROCARGS2: c_int = 49;
const ESRCH: c_int = 3;

unsafe extern "C" {
    fn sysctl(name: *mut c_int, namelen: c_uint, oldp: *mut c_void,
        oldlenp: *mut usize, newp: *mut c_void, newlen: usize) -> c_int;
    fn kill(pid: c_int, signal: c_int) -> c_int;
}

pub(crate) fn running(directory: &Path) -> Result<Option<(u32, u16)>, String> {
    let lock = match fs::read_link(directory.join("SingletonLock")) {
        Ok(lock) => lock,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取店铺浏览器锁失败：{error}")),
    };
    let pid = lock.as_os_str().as_bytes().rsplit(|byte| *byte == b'-').next()
        .and_then(|value| std::str::from_utf8(value).ok())
        .and_then(|value| value.parse::<c_int>().ok())
        .filter(|pid| *pid > 0)
        .ok_or("店铺浏览器锁中的进程编号无效")?;
    if !process_exists(pid)? { return Ok(None); }
    let Some(raw) = read_args(pid)? else { return Ok(None); };

    // Apple ps uses this layout: native int argc, saved executable path, NUL
    // padding, then exactly argc NUL-terminated argv strings. Stop before envp.
    // https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/print.c
    let invalid = "店铺浏览器进程参数格式无效";
    let argc = c_int::from_ne_bytes(raw.get(..size_of::<c_int>()).ok_or(invalid)?
        .try_into().map_err(|_| invalid)?);
    if argc < 1 { return Err(invalid.into()); }
    let mut data = &raw[size_of::<c_int>()..];
    let end = data.iter().position(|byte| *byte == 0).ok_or(invalid)?;
    let executable = Path::new(OsStr::from_bytes(&data[..end]));
    if !executable.ends_with(Path::new(crate::chrome_runtime::MAC_APP_BUNDLE).join("Contents/MacOS/Chromium")) {
        return Err("店铺目录被非大懒虫浏览器进程占用".into());
    }
    data = &data[end + 1..];
    while data.first() == Some(&0) { data = &data[1..]; }
    let mut arguments = Vec::new();
    for _ in 0..argc {
        let end = data.iter().position(|byte| *byte == 0).ok_or(invalid)?;
        arguments.push(&data[..end]);
        data = &data[end + 1..];
    }
    if arguments.iter().any(|arg| *arg == b"--type" || arg.starts_with(b"--type=")) {
        return Err("店铺浏览器锁未指向大懒虫浏览器主进程".into());
    }
    let profile = arguments.iter().find_map(|arg| arg.strip_prefix(b"--user-data-dir="))
        .ok_or("无法确认店铺浏览器的数据目录")?;
    let profile = fs::canonicalize(Path::new(OsStr::from_bytes(profile)))
        .map_err(|error| format!("读取浏览器数据目录失败：{error}"))?;
    let expected = fs::canonicalize(directory)
        .map_err(|error| format!("读取店铺数据目录失败：{error}"))?;
    if profile != expected {
        return Err("浏览器进程与店铺数据目录不匹配".into());
    }
    let port = arguments.iter().find_map(|arg| arg.strip_prefix(b"--remote-debugging-port="))
        .and_then(|value| std::str::from_utf8(value).ok())
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or("店铺浏览器未提供有效的本机调试端口")?;
    let port = if port == 0 {
        let active = match fs::read_to_string(directory.join("DevToolsActivePort")) {
            Ok(active) => active,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Some((pid as u32, 0))),
            Err(error) => return Err(format!("读取店铺浏览器调试端口失败：{error}")),
        };
        active.lines().next().and_then(|value| value.parse::<u16>().ok())
            .filter(|port| *port != 0).ok_or("店铺浏览器调试端口尚未就绪")?
    } else { port };
    Ok(Some((pid as u32, port)))
}

fn process_exists(pid: c_int) -> Result<bool, String> {
    // SAFETY: the parsed PID is positive. Signal zero only checks existence and
    // access; it does not deliver a signal or change the process.
    if unsafe { kill(pid, 0) } == 0 { return Ok(true); }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(ESRCH) { Ok(false) }
    else { Err(format!("无法确认店铺浏览器进程：{error}")) }
}

fn read_args(pid: c_int) -> Result<Option<Vec<u8>>, String> {
    let mut argmax: c_int = 0;
    let mut length = size_of::<c_int>();
    let mut mib = [CTL_KERN, KERN_ARGMAX];
    // SAFETY: MIB and integer output are initialized, aligned stack storage.
    // oldlenp describes that output; null newp and zero newlen make this read-only.
    if unsafe { sysctl(mib.as_mut_ptr(), mib.len() as c_uint,
        (&mut argmax as *mut c_int).cast(), &mut length, ptr::null_mut(), 0) } != 0
    {
        return Err(format!("读取系统进程参数长度失败：{}", io::Error::last_os_error()));
    }
    if length != size_of::<c_int>() || argmax <= size_of::<c_int>() as c_int {
        return Err("系统进程参数长度无效".into());
    }
    let mut data = vec![0u8; argmax as usize];
    length = data.len();
    let mut mib = [CTL_KERN, KERN_PROCARGS2, pid];
    // SAFETY: data owns length initialized writable bytes throughout sysctl.
    // The kernel writes bytes, not aligned Rust values; argc is decoded by copy.
    // No new value is supplied, and only the returned byte range is parsed.
    if unsafe { sysctl(mib.as_mut_ptr(), mib.len() as c_uint,
        data.as_mut_ptr().cast(), &mut length, ptr::null_mut(), 0) } != 0
    {
        let error = io::Error::last_os_error();
        // XNU also uses EINVAL for inaccessible argv, not just a missing PID.
        // Distinguish a process that exited during the read from a live failure.
        if !process_exists(pid)? { return Ok(None); }
        return Err(format!("读取店铺浏览器进程参数失败：{error}"));
    }
    if length > data.len() { return Err("店铺浏览器进程参数长度无效".into()); }
    data.truncate(length);
    Ok(Some(data))
}
