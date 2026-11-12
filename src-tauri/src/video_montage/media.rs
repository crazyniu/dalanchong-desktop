//! AI module map
//! Purpose: own FFmpeg/FFprobe discovery, cancellable child processes, and media metadata.
//! Entry: engine.rs calls Tools::discover, probe, and ffmpeg for one native montage job.
//! Flow: each child has owned pipe readers; the worker polls cancellation/license while
//! draining real encoder progress. The child is killed and reaped before an error returns.
//! Boundaries: no shell, network, encoder fallback, or Python dependency is used. Tool
//! overrides select explicit local binaries; diagnostics contain media/tool errors only.

use super::JobControl;
use serde_json::Value;
use std::{
    env,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};
use tauri::AppHandle;

#[derive(Clone)]
pub struct Tools {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
}

#[derive(Clone)]
pub struct MediaInfo {
    pub path: PathBuf,
    pub duration: f64,
    pub has_audio: bool,
    pub audio_codec: String,
    pub frames: Option<u64>,
}

fn find_tool(name: &str, variable: &str, sibling: Option<&Path>) -> Result<PathBuf, String> {
    if let Some(path) = env::var_os(variable) {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("{variable} 指向的文件不存在：{}", path.display()));
    }
    let mut directories = Vec::new();
    if let Some(path) = sibling {
        directories.push(path.to_path_buf());
    }
    directories.extend([
        PathBuf::from("/opt/homebrew/opt/ffmpeg-full/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    if let Some(path) = env::var_os("PATH") {
        directories.extend(env::split_paths(&path));
    }
    directories
        .into_iter()
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
        .ok_or_else(|| format!("未找到 {name}，请先安装 FFmpeg，或设置 {variable}"))
}

impl Tools {
    pub fn discover() -> Result<Self, String> {
        let ffmpeg = find_tool("ffmpeg", "DALANCHONG_FFMPEG", None)?;
        let ffprobe = find_tool("ffprobe", "DALANCHONG_FFPROBE", ffmpeg.parent())?;
        Ok(Self { ffmpeg, ffprobe })
    }
}

pub fn path_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// The caller owns stage weighting; reported fractions come from encoder output time.
fn command(
    app: &AppHandle,
    control: &JobControl,
    binary: &Path,
    args: &[String],
    duration: Option<f64>,
    progress: &mut dyn FnMut(f64),
) -> Result<String, String> {
    control.check(app)?;
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("启动 {} 失败：{error}", binary.display()))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (sender, receiver) = mpsc::channel();
    let output_reader = thread::spawn(move || {
        let mut output = String::new();
        for line in BufReader::new(stdout).lines() {
            let line = line.map_err(|error| error.to_string())?;
            output.push_str(&line);
            output.push('\n');
            let _ = sender.send(line);
        }
        Ok::<String, String>(output)
    });
    let error_reader = thread::spawn(move || {
        let mut tail = Vec::new();
        let mut buffer = [0u8; 8192];
        let mut input = stderr;
        loop {
            let count = input.read(&mut buffer).map_err(|error| error.to_string())?;
            if count == 0 {
                break;
            }
            tail.extend_from_slice(&buffer[..count]);
            if tail.len() > 65536 {
                tail.drain(..tail.len() - 65536);
            }
        }
        Ok::<String, String>(String::from_utf8_lossy(&tail).into_owned())
    });
    let mut cancelled = None;
    let status = loop {
        for line in receiver.try_iter() {
            if let (Some(length), Some(value)) = (duration, line.strip_prefix("out_time_us=")) {
                if let Ok(micros) = value.parse::<f64>() {
                    progress((micros / 1_000_000.0 / length).clamp(0.0, 1.0));
                }
            }
        }
        if let Err(error) = control.check(app) {
            cancelled = Some(error);
            let _ = child.kill();
            break child.wait().map_err(|error| error.to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(error.to_string());
            }
        }
    };
    let stdout = output_reader.join().map_err(|_| "读取媒体进程输出失败".to_string());
    let stderr = error_reader.join().map_err(|_| "读取媒体进程错误失败".to_string());
    if let Some(error) = cancelled {
        return Err(error);
    }
    let stdout = stdout??;
    let stderr = stderr??;
    if !status?.success() {
        return Err(format!("{} 处理失败：{}", binary.file_name().unwrap().to_string_lossy(), stderr.trim()));
    }
    control.check(app)?;
    if duration.is_some() {
        progress(1.0);
    }
    Ok(stdout)
}

pub fn ffmpeg(
    app: &AppHandle,
    control: &JobControl,
    tools: &Tools,
    args: Vec<String>,
    duration: f64,
    progress: &mut dyn FnMut(f64),
) -> Result<(), String> {
    let mut command_args = vec![
        "-hide_banner".into(), "-loglevel".into(), "error".into(), "-nostdin".into(),
        "-y".into(), "-progress".into(), "pipe:1".into(), "-nostats".into(),
    ];
    command_args.extend(args);
    command(app, control, &tools.ffmpeg, &command_args, Some(duration), progress)?;
    Ok(())
}

fn number(value: &Value) -> Option<f64> {
    value.as_f64().or_else(|| value.as_str().and_then(|text| text.parse().ok()))
}

pub fn probe(app: &AppHandle, control: &JobControl, tools: &Tools, path: &Path) -> Result<MediaInfo, String> {
    let args = vec![
        "-v".into(), "error".into(), "-show_entries".into(),
        "stream=codec_type,codec_name,width,height,duration,nb_frames:stream_tags=rotate:stream_side_data=rotation:format=duration".into(),
        "-of".into(), "json".into(), path_arg(path),
    ];
    let output = command(app, control, &tools.ffprobe, &args, None, &mut |_| {})?;
    let data: Value = serde_json::from_str(&output).map_err(|error| format!("媒体信息无法读取：{}：{error}", path.display()))?;
    let streams = data["streams"].as_array().ok_or_else(|| format!("没有媒体流：{}", path.display()))?;
    let video = streams.iter().find(|stream| stream["codec_type"] == "video")
        .ok_or_else(|| format!("没有视频画面：{}", path.display()))?;
    let duration = number(&video["duration"]).filter(|value| *value > 0.0)
        .or_else(|| number(&data["format"]["duration"]).filter(|value| *value > 0.0))
        .ok_or_else(|| format!("无法读取视频时长：{}", path.display()))?;
    let mut width = video["width"].as_u64().unwrap_or(0) as u32;
    let mut height = video["height"].as_u64().unwrap_or(0) as u32;
    let rotation = video["side_data_list"].as_array()
        .and_then(|items| items.iter().find_map(|item| number(&item["rotation"])))
        .or_else(|| number(&video["tags"]["rotate"])).unwrap_or(0.0);
    if (rotation.round() as i64).rem_euclid(180) == 90 {
        std::mem::swap(&mut width, &mut height);
    }
    if width == 0 || height == 0 {
        return Err(format!("视频尺寸无效：{}", path.display()));
    }
    let audio = streams.iter().find(|stream| stream["codec_type"] == "audio");
    let frames = video["nb_frames"].as_str().and_then(|value| value.parse().ok());
    Ok(MediaInfo {
        path: path.to_path_buf(), duration, has_audio: audio.is_some(),
        audio_codec: audio.and_then(|stream| stream["codec_name"].as_str()).unwrap_or("").to_string(), frames,
    })
}

pub fn encoding_args() -> Vec<String> {
    ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-r", "30", "-fps_mode", "cfr", "-movflags", "+faststart"]
        .iter().map(|value| (*value).to_string()).collect()
}

/// Match TUI's supported legacy SRT encoding only after UTF-8 decoding actually fails.
pub fn subtitle_text(app: &AppHandle, control: &JobControl, path: &Path) -> Result<String, String> {
    control.check(app)?;
    let bytes = fs::read(path).map_err(|error| format!("读取字幕失败：{error}"))?;
    match String::from_utf8(bytes) {
        Ok(text) => Ok(text),
        Err(_) => {
            let args = vec!["-f".into(), "GB18030".into(), "-t".into(), "UTF-8".into(), path_arg(path)];
            command(app, control, Path::new("/usr/bin/iconv"), &args, None, &mut |_| {})
                .map_err(|error| format!("字幕不是有效 UTF-8，按 GB18030 读取也失败：{error}"))
        }
    }
}

pub fn ensure_frames(app: &AppHandle, control: &JobControl, tools: &Tools, path: &Path, frames: u64) -> Result<(), String> {
    let info = probe(app, control, tools, path)?;
    if info.frames != Some(frames) {
        return Err(format!("视频帧数不足或不匹配：{}，需要{frames}帧，实际{}", path.display(),
            info.frames.map(|value| value.to_string()).unwrap_or_else(|| "未知".into())));
    }
    Ok(())
}
