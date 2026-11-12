//! AI module map
//! Purpose: serve allowlisted local montage videos through the montage-video protocol.
//! Entry: response is called by the native URI callback with its actual WebView label.
//! Flow: enforce main/Mac/license first, percent-decode the requested path through url's
//! file-URL conversion, canonicalize, consult the session registry, then read GET/HEAD data.
//! Ownership: each request owns its file handle and bounded range buffer; no server, process,
//! persistent grant, transcoder, or broad filesystem scope is created. Single HTTP byte ranges
//! return at most 1 MiB with their actual Content-Range. Non-range GET returns the complete file.

use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::Path,
};
use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    AppHandle,
};
use url::Url;

const MAX_RANGE_BYTES: u64 = 1024 * 1024;

fn reply(status: StatusCode, content_type: &str, body: Vec<u8>, head: bool) -> Response<Vec<u8>> {
    let length = body.len();
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, length.to_string())
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Range")
        .header(header::ACCESS_CONTROL_EXPOSE_HEADERS, "Accept-Ranges, Content-Length, Content-Range")
        .body(if head { Vec::new() } else { body })
        .unwrap()
}

fn error(status: StatusCode, message: &str, head: bool) -> Response<Vec<u8>> {
    reply(status, "text/plain; charset=utf-8", message.as_bytes().to_vec(), head)
}

fn unsatisfied(length: u64, head: bool) -> Response<Vec<u8>> {
    let mut response = error(StatusCode::RANGE_NOT_SATISFIABLE, "视频范围无效", head);
    response.headers_mut().insert(header::CONTENT_RANGE,
        format!("bytes */{length}").parse().unwrap());
    response.headers_mut().insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    response
}

fn content_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => Some("video/mp4"),
        "mov" => Some("video/quicktime"),
        "mkv" => Some("video/x-matroska"),
        _ => None,
    }
}

/// Return the first bounded response range inside the requested single byte interval.
fn byte_range(value: &str, length: u64) -> Option<(u64, u64)> {
    if length == 0 {
        return None;
    }
    let (unit, interval) = value.trim().split_once('=')?;
    if !unit.eq_ignore_ascii_case("bytes") || interval.contains(',') {
        return None;
    }
    let (start, end) = interval.split_once('-')?;
    let (start, end) = if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        (length.saturating_sub(suffix), length - 1)
    } else {
        let start = start.parse::<u64>().ok()?;
        if start >= length {
            return None;
        }
        let end = if end.is_empty() { length - 1 } else { end.parse::<u64>().ok()?.min(length - 1) };
        if end < start {
            return None;
        }
        (start, end)
    };
    Some((start, end.min(start.saturating_add(MAX_RANGE_BYTES - 1))))
}

/// The supplied label is native protocol context, never a JavaScript request parameter.
pub fn response(app: &AppHandle, webview_label: &str, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let head = request.method() == Method::HEAD;
    if webview_label != "main" || !cfg!(target_os = "macos") || crate::license::require_valid(app).is_err() {
        return error(StatusCode::FORBIDDEN, "无权预览此视频", head);
    }
    if request.method() != Method::GET && !head {
        let mut response = error(StatusCode::METHOD_NOT_ALLOWED, "不支持此请求方法", false);
        response.headers_mut().insert(header::ALLOW, "GET, HEAD".parse().unwrap());
        return response;
    }

    // Tauri convertFileSrc encodes the complete absolute path, including its slashes.
    // url 2.x's Unix to_file_path percent-decodes each path segment; the initial
    // decoded slash can produce //Users, which canonicalization normalizes below.
    let path = match Url::parse(&format!("file://localhost{}", request.uri().path()))
        .ok().and_then(|url| url.to_file_path().ok())
    {
        Some(path) => path,
        None => return error(StatusCode::BAD_REQUEST, "视频路径无效", head),
    };
    let path = match fs::canonicalize(path) {
        Ok(path) => path,
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => {
            return error(StatusCode::NOT_FOUND, "视频文件不存在", head);
        }
        Err(failure) if failure.kind() == std::io::ErrorKind::InvalidInput => {
            return error(StatusCode::BAD_REQUEST, "视频路径无效", head);
        }
        Err(failure) => return error(StatusCode::INTERNAL_SERVER_ERROR, &format!("读取视频路径失败：{failure}"), head),
    };
    if !super::preview_path_allowed(app, &path) {
        return error(StatusCode::FORBIDDEN, "此视频未授权预览", head);
    }
    let Some(kind) = content_type(&path) else {
        return error(StatusCode::UNSUPPORTED_MEDIA_TYPE, "此格式无法预览", head);
    };
    let mut file = match File::open(&path) {
        Ok(file) => file,
        Err(failure) => return error(StatusCode::INTERNAL_SERVER_ERROR, &format!("打开视频失败：{failure}"), head),
    };
    let metadata = match file.metadata() {
        Ok(metadata) => metadata,
        Err(failure) => return error(StatusCode::INTERNAL_SERVER_ERROR, &format!("读取视频信息失败：{failure}"), head),
    };
    if !metadata.is_file() {
        return error(StatusCode::NOT_FOUND, "视频文件不存在", head);
    }
    let length = metadata.len();
    if length == 0 {
        return if !head && request.headers().contains_key(header::RANGE) {
            unsatisfied(0, head)
        } else {
            error(StatusCode::BAD_REQUEST, "视频文件为空", head)
        };
    }

    // Range applies to GET; HEAD reports the complete representation's headers only.
    let mut ranges = request.headers().get_all(header::RANGE).iter();
    let requested_range = if head { None } else { ranges.next() };
    let range = if let Some(value) = requested_range {
        if ranges.next().is_some() {
            return unsatisfied(length, false);
        }
        match value.to_str().ok().and_then(|value| byte_range(value, length)) {
            Some(range) => Some(range),
            None => return unsatisfied(length, false),
        }
    } else {
        None
    };
    let mut body = Vec::new();
    let (status, content_length) = if let Some((start, end)) = range {
        let count = end - start + 1;
        body.resize(count as usize, 0);
        if let Err(failure) = file.seek(SeekFrom::Start(start)).and_then(|_| file.read_exact(&mut body)) {
            return error(StatusCode::INTERNAL_SERVER_ERROR, &format!("读取视频片段失败：{failure}"), false);
        }
        (StatusCode::PARTIAL_CONTENT, count)
    } else if head {
        (StatusCode::OK, length)
    } else {
        if let Err(failure) = file.read_to_end(&mut body) {
            return error(StatusCode::INTERNAL_SERVER_ERROR, &format!("读取视频失败：{failure}"), false);
        }
        (StatusCode::OK, body.len() as u64)
    };
    let mut response = reply(status, kind, body, head);
    response.headers_mut().insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());
    response.headers_mut().insert(header::CONTENT_LENGTH, content_length.to_string().parse().unwrap());
    if let Some((start, end)) = range {
        response.headers_mut().insert(header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{length}").parse().unwrap());
    }
    response
}
