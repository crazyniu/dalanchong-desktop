//! AI module map
//! Purpose: own the Mac video-montage batch lifecycle and native filesystem input.
//! Entry: video_montage_platform, video_montage_pick_directory, video_montage_list,
//! video_montage_open_directory, video_montage_state, video_montage_start, and
//! video_montage_cancel are main-WebView IPC commands registered by lib.rs.
//! Flow: capture canonical directory/settings/source snapshots and validated target
//! selections, register one batch in the shared Tasks map, and execute engine.rs on an
//! owned blocking worker. Unselected source files remain donors. Engine progress replaces
//! one source row and emits video-montage:state only to the main WebView.
//! Validated workers bounds the engine's parallel targets; each target owns its row and copies.
//! Ownership: MontageJobs holds the live snapshot and cancellation flag across routes.
//! Snapshot revisions increase under the job lock so late IPC/events cannot restore stale state.
//! Current-batch logs retain at most 500 actual transitions in memory. Session preview
//! paths contain only files returned by listing; preview.rs checks the native main caller
//! and license before reading any registered local video through the dedicated protocol.
//! No sync lock crosses filesystem work, encoding, await, or event publication. Combined
//! task/job transitions lock Tasks before MontageJobs, matching updater exclusion.
//! Boundaries: filesystem/start operations require Mac, the real main caller, and the
//! current native license result. State/cancel remain available after license expiry.
//! Nested symlinks are not followed; source/output files and account data are not removed.

mod engine;
mod media;
mod planner;
mod preview;

pub use preview::response as preview_response;

use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering as AtomicOrdering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, Webview};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

const TASK_KEY: &str = "video-montage";
const STATE_EVENT: &str = "video-montage:state";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MontageSettings {
    pub source_dir: String,
    pub background_dir: String,
    pub intro_dir: String,
    pub output_dir: String,
    pub default_copies: u32,
    #[serde(default = "default_workers")]
    pub workers: u32,
    pub scale_percent: f64,
    pub opacity_percent: f64,
    pub frame_mode: String,
    pub high_fps: u32,
}

fn default_workers() -> u32 {
    5
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MontageProgress {
    pub source_path: String,
    pub name: String,
    pub status: String,
    pub stage: String,
    pub progress: f64,
    pub completed: u32,
    pub total: u32,
    pub output_paths: Vec<String>,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MontageLog {
    pub id: String,
    pub timestamp: u64,
    pub source_path: String,
    pub video_name: String,
    pub level: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MontageSnapshot {
    pub revision: u64,
    pub running: bool,
    pub status: String,
    pub rows: Vec<MontageProgress>,
    pub logs: Vec<MontageLog>,
    pub output_dir: String,
    pub error: Option<String>,
}

impl Default for MontageSnapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            running: false,
            status: "idle".into(),
            rows: Vec::new(),
            logs: Vec::new(),
            output_dir: String::new(),
            error: None,
        }
    }
}

#[derive(Default)]
pub struct JobControl {
    pub cancelled: AtomicBool,
}

impl JobControl {
    /// Process runners call this while polling owned children; licensing is an in-memory read.
    pub fn check(&self, app: &AppHandle) -> Result<(), String> {
        if self.cancelled.load(AtomicOrdering::SeqCst) || crate::is_shutting_down() {
            return Err("已停止视频混剪".into());
        }
        crate::license::require_valid(app)
    }
}

#[derive(Default)]
struct MontageJobState {
    snapshot: MontageSnapshot,
    control: Option<Arc<JobControl>>,
    approved_preview_paths: HashSet<PathBuf>,
}

#[derive(Default)]
pub struct MontageJobs(Mutex<MontageJobState>);

/// The protocol handler canonicalizes and authorizes its native caller before this lookup.
pub(crate) fn preview_path_allowed(app: &AppHandle, path: &Path) -> bool {
    let jobs = app.state::<MontageJobs>();
    let current = jobs.0.lock().unwrap();
    current.approved_preview_paths.contains(path)
}

fn append_log(
    snapshot: &mut MontageSnapshot,
    source_path: &str,
    video_name: &str,
    level: &str,
    message: String,
) {
    snapshot.logs.push(MontageLog {
        id: Uuid::new_v4().to_string(),
        timestamp: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock precedes the Unix epoch")
            .as_millis() as u64,
        source_path: source_path.into(),
        video_name: video_name.into(),
        level: level.into(),
        message,
    });
    if snapshot.logs.len() > 500 {
        snapshot.logs.remove(0);
    }
}

fn publish_state(app: &AppHandle, snapshot: &MontageSnapshot) {
    if let Err(error) = app.emit_to("main", STATE_EVENT, snapshot) {
        eprintln!("发布视频混剪状态失败：{error}");
    }
}

/// The engine owns row contents; this controller owns the batch snapshot and event target.
pub(crate) fn update_progress(app: &AppHandle, row: MontageProgress) {
    let snapshot = {
        let jobs = app.state::<MontageJobs>();
        let mut current = jobs.0.lock().unwrap();
        if let Some(existing) = current
            .snapshot
            .rows
            .iter_mut()
            .find(|existing| existing.source_path == row.source_path)
        {
            let significant = existing.stage != row.stage
                || existing.status != row.status
                || existing.completed != row.completed
                || existing.error != row.error
                || (existing.progress / 10.0).floor() != (row.progress / 10.0).floor();
            let log = significant.then(|| {
                let level = match row.status.as_str() {
                    "failed" => "error",
                    "completed" => "success",
                    _ => "info",
                };
                let message = match &row.error {
                    Some(error) => format!("{}：{error}", row.stage),
                    None => format!(
                        "{} · {:.0}% · 已完成 {}/{} 份",
                        row.stage, row.progress, row.completed, row.total
                    ),
                };
                (row.source_path.clone(), row.name.clone(), level, message)
            });
            *existing = row;
            if let Some((source, name, level, message)) = log {
                append_log(&mut current.snapshot, &source, &name, level, message);
            }
            current.snapshot.revision += 1;
        }
        current.snapshot.clone()
    };
    publish_state(app, &snapshot);
}

/// Signal the worker before shutdown releases application state or exits the event loop.
pub fn cancel_on_shutdown(app: &AppHandle) {
    let jobs = app.state::<MontageJobs>();
    let current = jobs.0.lock().unwrap();
    if let Some(control) = &current.control {
        control.cancelled.store(true, AtomicOrdering::SeqCst);
    }
}

/// Shutdown signals cancellation first, then waits for engine child cleanup and task removal.
pub async fn wait_for_shutdown(app: &AppHandle) {
    loop {
        let running = app.state::<MontageJobs>().0.lock().unwrap().snapshot.running;
        if !running {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

fn finish_job(app: &AppHandle, control: &JobControl, result: Result<(), String>) {
    let snapshot = {
        let tasks = app.state::<crate::Tasks>();
        let mut tasks = tasks.0.lock().unwrap();
        let jobs = app.state::<MontageJobs>();
        let mut current = jobs.0.lock().unwrap();
        let stopped = control.cancelled.load(AtomicOrdering::SeqCst) || crate::is_shutting_down();
        current.snapshot.revision += 1;
        current.snapshot.running = false;
        if stopped {
            current.snapshot.status = "cancelled".into();
            for row in &mut current.snapshot.rows {
                if matches!(row.status.as_str(), "waiting" | "processing") {
                    row.status = "cancelled".into();
                    row.stage = "已停止".into();
                }
            }
        } else if let Err(error) = result {
            current.snapshot.status = "failed".into();
            current.snapshot.error = Some(error.clone());
            for row in &mut current.snapshot.rows {
                if row.status == "processing" {
                    row.status = "failed".into();
                    row.stage = "处理失败".into();
                    row.error = Some(error.clone());
                } else if row.status == "waiting" {
                    row.status = "cancelled".into();
                    row.stage = "未执行".into();
                }
            }
        } else {
            current.snapshot.error = current
                .snapshot
                .rows
                .iter()
                .find_map(|row| row.error.clone());
            current.snapshot.status = if current
                .snapshot
                .rows
                .iter()
                .any(|row| row.status == "failed")
            {
                "failed"
            } else {
                "completed"
            }
            .into();
        }
        let completed: u32 = current.snapshot.rows.iter().map(|row| row.completed).sum();
        let (level, message) = match current.snapshot.status.as_str() {
            "cancelled" => ("info", format!("混剪已停止，已完成 {completed} 份")),
            "failed" => (
                "error",
                match &current.snapshot.error {
                    Some(error) => format!("混剪失败：{error}"),
                    None => format!("部分视频处理失败，已完成 {completed} 份"),
                },
            ),
            _ => ("success", format!("混剪完成，共导出 {completed} 份")),
        };
        append_log(&mut current.snapshot, "", "", level, message);
        current.control = None;
        tasks.remove(TASK_KEY);
        current.snapshot.clone()
    };
    publish_state(app, &snapshot);
}

fn existing_directory(value: &str, label: &str) -> Result<PathBuf, String> {
    if value.trim().is_empty() {
        return Err(format!("请选择{label}"));
    }
    let path = fs::canonicalize(value).map_err(|error| format!("读取{label}失败：{error}"))?;
    if !fs::metadata(&path)
        .map_err(|error| format!("读取{label}失败：{error}"))?
        .is_dir()
    {
        return Err(format!("请选择{label}"));
    }
    Ok(path)
}

fn prepare_batch(
    mut settings: MontageSettings,
    source_paths: Vec<String>,
    excluded_paths: Vec<String>,
) -> Result<(MontageSettings, Vec<PathBuf>, Vec<PathBuf>), String> {
    if !(1..=99).contains(&settings.default_copies) {
        return Err("裂变数量必须为 1～99".into());
    }
    if !(1..=99).contains(&settings.workers) {
        return Err("线程数必须为 1～99".into());
    }
    if !(50.0..=100.0).contains(&settings.scale_percent) {
        return Err("画面比例必须为 50%～100%".into());
    }
    if !(1.0..=100.0).contains(&settings.opacity_percent) {
        return Err("画面不透明度必须为 1%～100%".into());
    }
    if !matches!(settings.frame_mode.as_str(), "default" | "high") {
        return Err("帧率模式无效".into());
    }
    if !(121..=240).contains(&settings.high_fps) {
        return Err("高帧率必须为 121～240".into());
    }
    let source = existing_directory(&settings.source_dir, "爆款视频目录")?;
    let background = existing_directory(&settings.background_dir, "画中画视频目录")?;
    let output = existing_directory(&settings.output_dir, "导出目录")?;
    if output.starts_with(&source) {
        return Err("导出目录不能放在爆款视频目录内".into());
    }
    settings.source_dir = source.to_string_lossy().into_owned();
    settings.background_dir = background.to_string_lossy().into_owned();
    settings.output_dir = output.to_string_lossy().into_owned();
    if !settings.intro_dir.trim().is_empty() {
        settings.intro_dir = existing_directory(&settings.intro_dir, "前贴目录")?
            .to_string_lossy()
            .into_owned();
    }
    let mut videos = Vec::new();
    collect_videos(&source, &source, &mut videos)?;
    // Exclusions only subtract known list IDs; removed files need not still exist on disk.
    let excluded: HashSet<PathBuf> = excluded_paths.into_iter().map(PathBuf::from).collect();
    videos.retain(|video| !excluded.contains(&PathBuf::from(&video.path)));
    videos.sort_by(|left, right| compare_paths(&left.relative_path, &right.relative_path));
    if videos.is_empty() {
        return Err("爆款视频目录内没有可用视频".into());
    }
    let sources: Vec<PathBuf> = videos.into_iter().map(|video| PathBuf::from(video.path)).collect();
    if source_paths.is_empty() {
        return Err("请选择需要处理的视频".into());
    }
    let selected: HashSet<PathBuf> = source_paths
        .into_iter()
        .map(|path| fs::canonicalize(path).map_err(|error| format!("读取所选视频失败：{error}")))
        .collect::<Result<_, _>>()?;
    let available: HashSet<PathBuf> = sources.iter().cloned().collect();
    for path in &selected {
        if !available.contains(path) {
            return Err(format!("所选视频不在爆款视频目录内：{}", path.display()));
        }
    }
    // Preserve directory ordering after selection while deduplicating aliases in the request.
    let targets = sources.iter().filter(|path| selected.contains(*path)).cloned().collect();
    Ok((settings, sources, targets))
}

#[tauri::command]
pub fn video_montage_state(app: AppHandle, webview: Webview) -> Result<MontageSnapshot, String> {
    crate::require_main(&webview)?;
    require_mac()?;
    Ok(app.state::<MontageJobs>().0.lock().unwrap().snapshot.clone())
}

/// Validate one immutable batch, register updater exclusion, then hand work to the native engine.
#[tauri::command]
pub async fn video_montage_start(
    app: AppHandle,
    webview: Webview,
    settings: MontageSettings,
    source_paths: Vec<String>,
    excluded_paths: Vec<String>,
) -> Result<MontageSnapshot, String> {
    crate::require_main(&webview)?;
    require_mac()?;
    crate::license::require_valid(&app)?;
    let (settings, sources, targets) =
        tauri::async_runtime::spawn_blocking(move || prepare_batch(settings, source_paths, excluded_paths))
            .await
            .map_err(|error| error.to_string())??;
    crate::license::require_valid(&app)?;
    let control = Arc::new(JobControl::default());
    let initial = {
        let tasks = app.state::<crate::Tasks>();
        let mut tasks = tasks.0.lock().unwrap();
        if crate::is_shutting_down() {
            return Err("软件正在退出".into());
        }
        if app.state::<crate::update::Updates>().is_installing() {
            return Err("正在安装更新，暂不能启动任务".into());
        }
        let jobs = app.state::<MontageJobs>();
        let mut current = jobs.0.lock().unwrap();
        if current.snapshot.running {
            return Err("视频混剪正在运行".into());
        }
        let mut snapshot = MontageSnapshot {
            revision: current.snapshot.revision + 1,
            running: true,
            status: "processing".into(),
            rows: targets
                .iter()
                .map(|source| MontageProgress {
                    source_path: source.to_string_lossy().into_owned(),
                    name: source.strip_prefix(Path::new(&settings.source_dir)).unwrap().to_string_lossy().into_owned(),
                    status: "waiting".into(),
                    stage: "等待处理".into(),
                    progress: 0.0,
                    completed: 0,
                    total: settings.default_copies,
                    output_paths: Vec::new(),
                    error: None,
                })
                .collect(),
            logs: Vec::new(),
            output_dir: settings.output_dir.clone(),
            error: None,
        };
        let target_count = targets.len();
        let total = target_count as u64 * u64::from(settings.default_copies);
        append_log(
            &mut snapshot,
            "",
            "",
            "info",
            format!("开始混剪：{target_count} 个视频，共 {total} 份 · 线程数 {}", settings.workers),
        );
        current.snapshot = snapshot.clone();
        current.control = Some(control.clone());
        tasks.insert(TASK_KEY.into(), false);
        snapshot
    };
    publish_state(&app, &initial);
    let worker_app = app.clone();
    let _worker = tauri::async_runtime::spawn_blocking(move || {
        let result = engine::run(&worker_app, &settings, &sources, &targets, &control);
        finish_job(&worker_app, &control, result);
    });
    Ok(initial)
}

/// Cancellation is allowed after expiry; the process runner owns stopping its child and cleanup.
#[tauri::command]
pub fn video_montage_cancel(app: AppHandle, webview: Webview) -> Result<MontageSnapshot, String> {
    crate::require_main(&webview)?;
    require_mac()?;
    let snapshot = {
        let jobs = app.state::<MontageJobs>();
        let mut current = jobs.0.lock().unwrap();
        if current.snapshot.running {
            let requested = current
                .control
                .as_ref()
                .is_some_and(|control| !control.cancelled.swap(true, AtomicOrdering::SeqCst));
            if requested {
                for row in &mut current.snapshot.rows {
                    if row.status == "processing" {
                        row.stage = "正在停止".into();
                    }
                }
                append_log(&mut current.snapshot, "", "", "info", "已请求停止视频混剪".into());
                current.snapshot.revision += 1;
            }
        }
        current.snapshot.clone()
    };
    publish_state(&app, &snapshot);
    Ok(snapshot)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MontageVideo {
    path: String,
    name: String,
    relative_path: String,
    size: u64,
    duration_seconds: Option<f64>,
}

fn require_mac() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        Ok(())
    } else {
        Err("视频混剪仅支持 Mac".into())
    }
}

/// Discover native platform before exposing the Mac-only menu; never infer permissions from UA.
#[tauri::command]
pub fn video_montage_platform(webview: Webview) -> Result<String, String> {
    crate::require_main(&webview)?;
    Ok(std::env::consts::OS.into())
}

/// Native cancellation returns None and leaves the page's existing directory unchanged.
#[tauri::command]
pub async fn video_montage_pick_directory(
    app: AppHandle,
    webview: Webview,
    kind: String,
) -> Result<Option<String>, String> {
    crate::require_main(&webview)?;
    require_mac()?;
    crate::license::require_valid(&app)?;
    let title = match kind.as_str() {
        "source" => "选择爆款视频目录",
        "background" => "选择画中画视频目录",
        "intro" => "选择前贴目录",
        "output" => "选择导出目录",
        _ => return Err("目录类型无效".into()),
    };
    let window = webview.window();
    tauri::async_runtime::spawn_blocking(move || {
        let selected = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_title(title)
            .blocking_pick_folder();
        selected
            .map(|entry| {
                entry
                    .into_path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .map_err(|error| error.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|error| error.to_string())?
}

fn collect_videos(
    root: &Path,
    directory: &Path,
    videos: &mut Vec<MontageVideo>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("读取视频目录失败：{error}"))?
    {
        let entry = entry.map_err(|error| format!("读取视频目录失败：{error}"))?;
        let kind = entry
            .file_type()
            .map_err(|error| format!("读取文件类型失败：{error}"))?;
        let path = entry.path();
        if kind.is_dir() {
            collect_videos(root, &path, videos)?;
        } else if kind.is_file() {
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !matches!(extension.as_str(), "mp4" | "mov" | "m4v" | "mkv") {
                continue;
            }
            let metadata = entry
                .metadata()
                .map_err(|error| format!("读取视频文件失败：{error}"))?;
            videos.push(MontageVideo {
                path: path.to_string_lossy().into_owned(),
                name: entry.file_name().to_string_lossy().into_owned(),
                // Every entry is constructed by walking descendants of this same root.
                relative_path: path.strip_prefix(root).unwrap().to_string_lossy().into_owned(),
                size: metadata.len(),
                duration_seconds: None,
            });
        }
        // DirEntry::file_type does not follow symlinks, so links enter neither branch.
    }
    Ok(())
}

fn compare_paths(left: &str, right: &str) -> Ordering {
    let mut left = left.chars().peekable();
    let mut right = right.chars().peekable();
    loop {
        let order = match (left.next(), right.next()) {
            (Some(a), Some(b)) if a.is_ascii_digit() && b.is_ascii_digit() => {
                let mut a_digits = String::from(a);
                let mut b_digits = String::from(b);
                while left.peek().is_some_and(char::is_ascii_digit) {
                    a_digits.push(left.next().unwrap());
                }
                while right.peek().is_some_and(char::is_ascii_digit) {
                    b_digits.push(right.next().unwrap());
                }
                let a_number = a_digits.trim_start_matches('0');
                let b_number = b_digits.trim_start_matches('0');
                a_number
                    .len()
                    .cmp(&b_number.len())
                    .then_with(|| a_number.cmp(b_number))
                    .then_with(|| a_digits.len().cmp(&b_digits.len()))
            }
            (Some(a), Some(b)) => a.cmp(&b),
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
        };
        if order != Ordering::Equal {
            return order;
        }
    }
}

/// Directory records contain filesystem metadata; the batch engine owns media-duration probing.
#[tauri::command]
pub async fn video_montage_list(
    app: AppHandle,
    webview: Webview,
    path: String,
) -> Result<Vec<MontageVideo>, String> {
    crate::require_main(&webview)?;
    require_mac()?;
    crate::license::require_valid(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = existing_directory(&path, "视频目录")?;
        let mut videos = Vec::new();
        collect_videos(&root, &root, &mut videos)?;
        videos.sort_by(|left, right| compare_paths(&left.relative_path, &right.relative_path));
        // Retained result rows can still preview files approved earlier in this app session.
        app.state::<MontageJobs>().0.lock().unwrap().approved_preview_paths
            .extend(videos.iter().map(|video| PathBuf::from(&video.path)));
        Ok(videos)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Open a verified directory without a shell or a caller-controlled executable.
#[tauri::command]
pub async fn video_montage_open_directory(
    app: AppHandle,
    webview: Webview,
    path: String,
) -> Result<(), String> {
    crate::require_main(&webview)?;
    require_mac()?;
    crate::license::require_valid(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if !fs::metadata(&path)
            .map_err(|error| format!("读取导出目录失败：{error}"))?
            .is_dir()
        {
            return Err("请选择导出目录".into());
        }
        let status = Command::new("/usr/bin/open")
            .arg(&path)
            .status()
            .map_err(|error| format!("打开导出目录失败：{error}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!("打开导出目录失败：{status}"))
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
