//! AI module map
//! Purpose: render selected viral targets using the complete donor pool, a dedicated
//! backdrop library, and optional intros.
//! Entry: the controller calls run on a blocking worker with a JobControl and immutable settings.
//! A bounded scoped pool processes separate target videos; copies within one target remain serial.
//! Flow: probe inputs once, plan independent A-first cuts per variant, render TUI-style shot
//! effects and stickers, compose the transparent backdrop, restore A audio, prepend an optional
//! intro, and optionally encode high-FPS replacement frames before atomic publication.
//! Ownership: work directories belong to this job and are removed on every return. Completed
//! variants publish directly into the selected output directory as source-stem_number.mp4;
//! existing numbers remain intact. Sticker credits live in feature-owned application data,
//! outside the exports. Child lifetime/cancellation belongs to media.rs; row events to the
//! controller. Input files, commerce accounts, and the source py-cut project are never edited.

use super::{media, planner, update_progress, JobControl, MontageProgress, MontageSettings};
use media::{MediaInfo, Tools};
use planner::{Effects, Random, Shot, FPS, HEIGHT, WIDTH};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
    thread,
};
use tauri::AppHandle;
use uuid::Uuid;

struct WorkDir(PathBuf);
impl WorkDir {
    fn new(parent: &Path) -> Result<Self, String> {
        let path = parent.join(format!(".work-{}", Uuid::new_v4().simple()));
        fs::create_dir(&path).map_err(|error| format!("创建混剪临时目录失败：{error}"))?;
        Ok(Self(path))
    }
}
impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn args(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn stage(app: &AppHandle, row: &mut MontageProgress, fraction: f64, name: &str) {
    row.status = "processing".into();
    row.stage = name.into();
    row.progress = (row.completed as f64 + fraction.clamp(0.0, 1.0)) / row.total as f64 * 100.0;
    update_progress(app, row.clone());
}

fn write_concat(path: &Path, videos: &[PathBuf]) -> Result<(), String> {
    let mut text = String::new();
    for video in videos {
        let raw = video.to_string_lossy();
        if raw.contains(['\n', '\r']) {
            return Err("素材路径不能包含换行".into());
        }
        text.push_str(&format!("file '{}'\n", raw.replace('\'', "'\\''")));
    }
    fs::write(path, text).map_err(|error| format!("写入混剪片段列表失败：{error}"))
}

/// Reserve the final name atomically so existing exports, including equal source
/// basenames from different input subfolders, are never replaced by a new variant.
fn publish_numbered(private: &Path, output: &Path, stem: &str) -> Result<PathBuf, String> {
    let prefix = format!("{stem}_");
    let mut highest = 0u64;
    for entry in fs::read_dir(output).map_err(|error| format!("读取导出目录失败：{error}"))? {
        let entry = entry.map_err(|error| format!("读取成片文件名失败：{error}"))?;
        let path = entry.path();
        if !path.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("mp4")) {
            continue;
        }
        if let Some(number) = path.file_stem().and_then(|value| value.to_str())
            .and_then(|value| value.strip_prefix(&prefix))
            .and_then(|value| value.parse::<u64>().ok())
        {
            highest = highest.max(number);
        }
    }
    let mut number = highest + 1;
    loop {
        let target = output.join(format!("{stem}_{number}.mp4"));
        match fs::OpenOptions::new().write(true).create_new(true).open(&target) {
            Ok(reservation) => {
                drop(reservation);
                if let Err(error) = fs::rename(private, &target) {
                    let _ = fs::remove_file(&target);
                    return Err(format!("发布成片失败：{error}"));
                }
                return Ok(target);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => number += 1,
            Err(error) => return Err(format!("创建成片文件失败：{error}")),
        }
    }
}

fn collect_video_paths(directory: &Path, label: &str, result: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| format!("读取{label}目录失败：{}：{error}", directory.display()))? {
        let entry = entry.map_err(|error| format!("读取{label}文件失败：{error}"))?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_dir() {
            collect_video_paths(&entry.path(), label, result)?;
        } else if kind.is_file() {
            let extension = entry.path().extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
            if matches!(extension.as_str(), "mp4" | "mov" | "m4v" | "mkv") {
                result.push(entry.path());
            }
        }
    }
    Ok(())
}

fn stickers(work: &Path) -> Result<Vec<PathBuf>, String> {
    let files: [(&str, &[u8]); 3] = [
        ("1f42d.png", include_bytes!("../../../assets/video-montage/1f42d.png")),
        ("2728.png", include_bytes!("../../../assets/video-montage/2728.png")),
        ("1f31f.png", include_bytes!("../../../assets/video-montage/1f31f.png")),
    ];
    let mut result = Vec::new();
    for (name, data) in files {
        let path = work.join(name);
        fs::write(&path, data).map_err(|error| format!("准备贴纸失败：{error}"))?;
        result.push(path);
    }
    Ok(result)
}

fn fit_filter() -> String {
    format!("scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30")
}

/// A single image frame repeats through overlay; never loop its demuxer input forever.
fn sticker_graph(input: &str, effect: &Effects) -> String {
    let corners = [
        ("29:29", "W-w-29:H-h-29"),
        ("W-w-29:29", "29:H-h-29"),
        ("29:H-h-29", "W-w-29:29"),
        ("W-w-29:H-h-29", "29:29"),
    ];
    let (first, second) = corners[effect.corner];
    "[1:v]scale=151:-2,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*0.55*((min(1\\,min(X\\,W-1-X)/67)+min(1\\,min(Y\\,H-1-Y)/67))/2)'[sticker];[sticker]split=2[s0][s1];".to_string()
        + &format!("[{input}][s0]overlay={first}:format=auto:shortest=0[marked];[marked][s1]overlay={second}:format=auto:shortest=0[stickers]")
}

fn render_shot(
    app: &AppHandle, control: &JobControl, tools: &Tools, source: &MediaInfo,
    shot: &Shot, sticker_paths: &[PathBuf], target: &Path, first: bool, last: bool,
    progress: &mut dyn FnMut(f64),
) -> Result<(), String> {
    let coarse = (shot.offset - 1.0).max(0.0);
    let fine = (shot.offset - coarse) / shot.speed;
    let duration = shot.frames as f64 / FPS;
    let mut command = args(&["-ss", &format!("{coarse:.8}"), "-i"]);
    command.push(media::path_arg(&source.path));
    command.extend(args(&["-i"]));
    command.push(media::path_arg(&sticker_paths[shot.effects.sticker]));
    let chain = format!("setpts=(PTS-STARTPTS)/{:.8},{},{},setsar=1", shot.speed, fit_filter(), shot.effects.filters());
    let mut graph = format!("[0:v]{chain}[segment];{}", sticker_graph("segment", &shot.effects));
    let fade = 0.2_f64.min(duration / 2.0);
    let mut fades = Vec::new();
    if !first {
        fades.push(format!("fade=t=in:st={fine:.8}:d={fade:.8}"));
    }
    if !last {
        fades.push(format!("fade=t=out:st={:.8}:d={fade:.8}", fine + duration - fade));
    }
    let label = if fades.is_empty() {
        "stickers"
    } else {
        graph.push_str(&format!(";[stickers]{}[out]", fades.join(",")));
        "out"
    };
    command.extend(args(&["-filter_complex_threads", "2", "-filter_complex", &graph,
        "-map", &format!("[{label}]"), "-ss", &format!("{fine:.8}"), "-frames:v", &shot.frames.to_string(), "-an", "-map_metadata", "-1"]));
    command.extend(media::encoding_args());
    command.push(media::path_arg(target));
    media::ffmpeg(app, control, tools, command, duration, progress)?;
    media::ensure_frames(app, control, tools, target, shot.frames)
}

fn concatenate(
    app: &AppHandle, control: &JobControl, tools: &Tools, videos: &[PathBuf],
    target: &Path, frames: u64, work: &Path, progress: &mut dyn FnMut(f64),
) -> Result<(), String> {
    let list = work.join(format!("concat-{}.txt", Uuid::new_v4().simple()));
    write_concat(&list, videos)?;
    let mut command = args(&["-f", "concat", "-safe", "0", "-i"]);
    command.push(media::path_arg(&list));
    command.extend(args(&["-map", "0:v:0", "-an", "-c:v", "copy", "-map_metadata", "-1", "-movflags", "+faststart"]));
    command.push(media::path_arg(target));
    media::ffmpeg(app, control, tools, command, frames as f64 / FPS, progress)?;
    media::ensure_frames(app, control, tools, target, frames)
}

fn compose_backdrop(
    app: &AppHandle, control: &JobControl, tools: &Tools, body: &Path, source: &MediaInfo,
    target: &Path, frames: u64, settings: &MontageSettings, random: &mut Random,
    progress: &mut dyn FnMut(f64),
) -> Result<(), String> {
    let duration = frames as f64 / FPS;
    let width = ((WIDTH as f64 * settings.scale_percent / 100.0).floor() as u32 / 2) * 2;
    let height = ((HEIGHT as f64 * width as f64 / WIDTH as f64).floor() as u32 / 2) * 2;
    let feather = (width as f64 * 0.035).round() as u32;
    let ramp = format!("min(1\\,min(min(X\\,W-1-X)\\,min(Y\\,H-1-Y))/{feather})");
    let alpha = format!("255*{:.8}*({ramp})*({ramp})*(3-2*({ramp}))", settings.opacity_percent / 100.0);
    let mut effect = Effects::draw(random);
    effect.mirror = false;
    let offset = random.range(0.0, (source.duration - 1.0 / FPS).max(0.0));
    let graph = format!(
        "[1:v]fps=30,scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},setsar=1,{},setsar=1,gblur=sigma=4,trim=end_frame={},setpts=N/(30*TB)[back];[0:v]scale={width}:{height},setsar=1,format=rgba,setpts=N/(30*TB)[front];color=white:s={width}x{height}:r=30:d=0.03333333333333333,format=gray,geq=lum='{alpha}',loop=loop={}:size=1:start=0,setpts=N/(30*TB)[mask];[front][mask]alphamerge=shortest=1:repeatlast=0[soft];[back][soft]overlay=(W-w)/2:(H-h)/2:shortest=1:repeatlast=0:format=auto,setsar=1[out]",
        effect.filters(), frames + 2, frames - 1,
    );
    let mut command = args(&["-filter_complex_threads", "2", "-reinit_filter", "0", "-i"]);
    command.push(media::path_arg(body));
    command.extend(args(&["-stream_loop", "-1", "-ss", &format!("{offset:.8}"), "-t", &format!("{:.8}", duration + 1.0), "-hwaccel", "auto", "-i"]));
    command.push(media::path_arg(&source.path));
    command.extend(args(&["-filter_complex", &graph, "-map", "[out]", "-an", "-frames:v", &frames.to_string(), "-map_metadata", "-1"]));
    command.extend(media::encoding_args());
    command.push(media::path_arg(target));
    media::ffmpeg(app, control, tools, command, duration, progress)?;
    media::ensure_frames(app, control, tools, target, frames)
}

fn escape_filter_path(path: &Path) -> String {
    media::path_arg(path).replace('\\', "\\\\").replace(':', "\\:").replace('\'', "'\\\\\\''")
}

fn subtitle_time(value: &str) -> Result<f64, String> {
    let value = value.trim().split_whitespace().next().unwrap_or("").replace(',', ".");
    let parts = value.split(':').map(str::parse::<f64>).collect::<Result<Vec<_>, _>>()
        .map_err(|_| "字幕时间格式无效".to_string())?;
    if parts.len() != 3 {
        return Err("字幕时间格式无效".into());
    }
    Ok(parts[0] * 3600.0 + parts[1] * 60.0 + parts[2])
}

fn ass_time(seconds: f64) -> String {
    let centiseconds = (seconds * 100.0).round() as u64;
    format!("{}:{:02}:{:02}.{:02}", centiseconds / 360000,
        centiseconds / 6000 % 60, centiseconds / 100 % 60, centiseconds % 100)
}

/// Pin ASS resolution so a 54-pixel font does not grow with libass's implicit SRT canvas.
fn prepare_subtitles(app: &AppHandle, control: &JobControl, source: &Path, target: &Path, duration: f64) -> Result<(), String> {
    let text = media::subtitle_text(app, control, source)?;
    let line_endings = text.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let normalized = line_endings.lines()
        .map(|line| if line.trim().is_empty() { "" } else { line })
        .collect::<Vec<_>>().join("\n");
    let mut output = "[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: montage,PingFang SC,54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,2,2,2,36,36,102,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n".to_string();
    let mut count = 0;
    for block in normalized.split("\n\n").filter(|block| !block.trim().is_empty()) {
        let lines = block.lines().collect::<Vec<_>>();
        let timing = lines.iter().position(|line| line.contains("-->"))
            .ok_or_else(|| "字幕缺少时间行".to_string())?;
        let (start, end) = lines[timing].split_once("-->").unwrap();
        let start = subtitle_time(start)?.max(0.0);
        let end = subtitle_time(end)?.min(duration);
        if start >= end {
            continue;
        }
        let mut wrapped = String::new();
        for line in lines.iter().skip(timing + 1) {
            if !wrapped.is_empty() {
                wrapped.push_str("\\N");
            }
            let mut width = 0.0;
            for character in line.chars() {
                let size = if character.is_ascii() { 0.55 } else { 1.0 };
                if width + size > 11.9 {
                    wrapped.push_str("\\N");
                    width = 0.0;
                }
                wrapped.push(match character { '{' => '｛', '}' => '｝', '\\' => '＼', other => other });
                width += size;
            }
        }
        if wrapped.is_empty() {
            continue;
        }
        output.push_str(&format!("Dialogue: 0,{},{},montage,,0,0,0,,{}\n", ass_time(start), ass_time(end), wrapped));
        count += 1;
    }
    if count == 0 {
        return Err("字幕没有处于原片时间轴内的有效内容".into());
    }
    fs::write(target, output).map_err(|error| format!("准备字幕失败：{error}"))
}

fn burn_subtitles(
    app: &AppHandle, control: &JobControl, tools: &Tools, video: &Path, subtitle: &Path,
    output: &Path, frames: u64, progress: &mut dyn FnMut(f64),
) -> Result<(), String> {
    let ass = output.with_extension("ass");
    prepare_subtitles(app, control, subtitle, &ass, frames as f64 / FPS)?;
    let filter = format!("subtitles=filename='{}'", escape_filter_path(&ass));
    let mut command = args(&["-i"]);
    command.push(media::path_arg(video));
    command.extend(args(&["-vf", &filter, "-map", "0:v:0", "-an", "-frames:v", &frames.to_string()]));
    command.extend(media::encoding_args());
    command.push(media::path_arg(output));
    media::ffmpeg(app, control, tools, command, frames as f64 / FPS, progress)?;
    media::ensure_frames(app, control, tools, output, frames)
}

fn attach_audio(
    app: &AppHandle, control: &JobControl, tools: &Tools, video: &Path, source: &MediaInfo,
    output: &Path, frames: u64, progress: &mut dyn FnMut(f64),
) -> Result<(), String> {
    let duration = frames as f64 / FPS;
    let mut command = args(&["-i"]);
    command.push(media::path_arg(video));
    command.push("-i".into());
    command.push(media::path_arg(&source.path));
    command.extend(args(&["-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy"]));
    // Only incompatible MP4 audio codecs are transcoded; compatible body audio is copied unfiltered.
    if matches!(source.audio_codec.as_str(), "aac" | "mp3" | "ac3" | "eac3" | "alac" | "opus") {
        command.extend(args(&["-c:a", "copy"]));
    } else {
        command.extend(args(&["-c:a", "aac", "-b:a", "192k"]));
    }
    command.extend(args(&["-t", &format!("{duration:.8}"), "-movflags", "+faststart"]));
    command.push(media::path_arg(output));
    media::ffmpeg(app, control, tools, command, duration, progress)?;
    media::ensure_frames(app, control, tools, output, frames)
}

fn prepend_intro(
    app: &AppHandle, control: &JobControl, tools: &Tools, body: &Path, intro: &MediaInfo,
    output: &Path, body_frames: u64, work: &Path, sticker_paths: &[PathBuf], random: &mut Random,
    progress: &mut dyn FnMut(f64),
) -> Result<u64, String> {
    let intro_frames = (intro.duration * FPS).round() as u64;
    let mut effect = Effects::draw(random);
    effect.mirror = false;
    let shot = Shot { source: 0, offset: 0.0, speed: 1.0, frames: intro_frames, effects: effect };
    let prepared = work.join("intro-picture.mp4");
    render_shot(app, control, tools, intro, &shot, sticker_paths, &prepared, true, true, &mut |value| progress(value * 0.7))?;
    let list = work.join("intro-join.txt");
    write_concat(&list, &[prepared, body.to_path_buf()])?;
    let intro_duration = intro_frames as f64 / FPS;
    let body_duration = body_frames as f64 / FPS;
    let mut command = args(&["-f", "concat", "-safe", "0", "-auto_convert", "1", "-i"]);
    command.push(media::path_arg(&list));
    command.push("-i".into());
    command.push(media::path_arg(body));
    if intro.has_audio {
        command.push("-i".into());
        command.push(media::path_arg(&intro.path));
    } else {
        command.extend(args(&["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]));
    }
    let graph = format!("[2:a:0]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,apad,atrim=duration={intro_duration:.8}[a0];[1:a:0]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,atrim=duration={body_duration:.8}[a1];[a0][a1]concat=n=2:v=0:a=1[a]");
    command.extend(args(&["-filter_complex", &graph, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-t", &format!("{:.8}", intro_duration + body_duration), "-movflags", "+faststart"]));
    command.push(media::path_arg(output));
    media::ffmpeg(app, control, tools, command, intro_duration + body_duration, &mut |value| progress(0.7 + 0.3 * value))?;
    let total = body_frames + intro_frames;
    media::ensure_frames(app, control, tools, output, total)?;
    Ok(total)
}

fn high_fps(
    app: &AppHandle, control: &JobControl, tools: &Tools, source: &Path, output: &Path,
    source_frames: u64, fps: u32, backdrops: &[MediaInfo], random: &mut Random,
    progress: &mut dyn FnMut(f64),
) -> Result<(), String> {
    let duration = source_frames as f64 / FPS;
    let frames = (source_frames * u64::from(fps)).div_ceil(FPS as u64);
    let picture = output.with_extension("picture.mp4");
    let filler = &backdrops[random.index(backdrops.len())];
    let offset = random.range(0.0, (filler.duration - 1.0 / FPS).max(0.0));
    // Generic timeline enable is evaluated before input0's frame_count_out increments:
    // its n is zero-based, unlike overlay x/y's internal n or blend's N variables.
    let replace = format!("gte(n\\,2)*eq(floor((n+1)*30/{fps})\\,floor(n*30/{fps}))");
    let filter = format!(
        "[0:v]fps={fps}:round=up,setsar=1,format=yuv420p,setpts=N/({fps}*TB)[payload];[1:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase,crop={WIDTH}:{HEIGHT},setsar=1,format=yuv420p,fps={fps}:round=up,trim=end_frame={},setpts=N/({fps}*TB)[filler];[payload][filler]overlay=0:0:format=yuv420:shortest=1:repeatlast=0:enable='{replace}'[out]",
        frames + 2,
    );
    let mut command = args(&["-i"]);
    command.push(media::path_arg(source));
    command.extend(args(&["-stream_loop", "-1", "-ss", &format!("{offset:.8}"), "-t", &format!("{:.8}", duration + 1.0), "-hwaccel", "auto", "-i"]));
    command.push(media::path_arg(&filler.path));
    command.extend(args(&["-filter_complex_threads", "2", "-filter_complex", &filter, "-map", "[out]", "-an", "-frames:v", &frames.to_string(), "-c:v", "libx264", "-preset", "fast", "-b:v", "8000k", "-minrate", "8000k", "-maxrate", "8000k", "-bufsize", "16000k", "-x264-params", "nal-hrd=cbr:filler=1", "-pix_fmt", "yuv420p", "-r", &fps.to_string(), "-fps_mode", "cfr", "-movflags", "+faststart"]));
    command.push(media::path_arg(&picture));
    media::ffmpeg(app, control, tools, command, duration, &mut |value| progress(value * 0.95))?;
    media::ensure_frames(app, control, tools, &picture, frames)?;
    // The video frame cap must not terminate audio demuxing; copy the finished payload
    // audio in a separate mux without frames/time/shortest limits to retain every packet.
    let mut mux = args(&["-i"]);
    mux.push(media::path_arg(&picture));
    mux.push("-i".into());
    mux.push(media::path_arg(source));
    mux.extend(args(&["-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", "-movflags", "+faststart"]));
    mux.push(media::path_arg(output));
    media::ffmpeg(app, control, tools, mux, duration, &mut |value| progress(0.95 + value * 0.05))?;
    media::ensure_frames(app, control, tools, output, frames)
}

fn render_variant(
    app: &AppHandle, control: &JobControl, tools: &Tools, settings: &MontageSettings,
    pool: &[MediaInfo], target_index: usize, backdrops: &[MediaInfo], intros: &[MediaInfo], work: &Path,
    sticker_paths: &[PathBuf], row: &mut MontageProgress,
) -> Result<PathBuf, String> {
    let mut random = Random::new();
    stage(app, row, 0.0, "切分原片与补充素材");
    let shots = planner::plan(pool, target_index, &mut random)?;
    let frames = (pool[target_index].duration * FPS).round() as u64;
    let mut videos = Vec::new();
    let mut finished_frames = 0u64;
    for (index, shot) in shots.iter().enumerate() {
        control.check(app)?;
        let output = work.join(format!("shot-{index:04}.mp4"));
        let name = format!("切片与画面处理 {}/{}", index + 1, shots.len());
        render_shot(app, control, tools, &pool[shot.source], shot, sticker_paths, &output,
            index == 0, index + 1 == shots.len(), &mut |value| {
                let fraction = (finished_frames as f64 + shot.frames as f64 * value) / frames as f64;
                stage(app, row, 0.02 + fraction * 0.58, &name);
            })?;
        finished_frames += shot.frames;
        videos.push(output);
    }
    let joined = work.join("joined.mp4");
    concatenate(app, control, tools, &videos, &joined, frames, work,
        &mut |value| stage(app, row, 0.60 + value * 0.03, "拼接画面"))?;
    let backdrop = &backdrops[random.index(backdrops.len())];
    let composed = work.join("backdrop.mp4");
    compose_backdrop(app, control, tools, &joined, backdrop, &composed, frames, settings, &mut random,
        &mut |value| stage(app, row, 0.63 + value * 0.22, "合成透明底片"))?;
    let srt = pool[target_index].path.with_extension("srt");
    let picture = if srt.is_file() {
        let subtitled = work.join("subtitles.mp4");
        burn_subtitles(app, control, tools, &composed, &srt, &subtitled, frames,
            &mut |value| stage(app, row, 0.85 + value * 0.04, "添加原片字幕"))?;
        subtitled
    } else { composed };
    let with_audio = work.join("original-audio.mp4");
    attach_audio(app, control, tools, &picture, &pool[target_index], &with_audio, frames,
        &mut |value| stage(app, row, 0.89 + value * 0.03, "保留原片音频"))?;
    let (finished, final_frames) = if intros.is_empty() {
        (with_audio, frames)
    } else {
        let intro = &intros[random.index(intros.len())];
        let combined = work.join("intro-body.mp4");
        let count = prepend_intro(app, control, tools, &with_audio, intro, &combined, frames, work, sticker_paths, &mut random,
            &mut |value| stage(app, row, 0.92 + value * 0.04, "添加前贴"))?;
        (combined, count)
    };
    if settings.frame_mode == "high" {
        let high = work.join("high-fps.mp4");
        high_fps(app, control, tools, &finished, &high, final_frames, settings.high_fps, backdrops, &mut random,
            &mut |value| stage(app, row, 0.96 + value * 0.04, "高帧率编码"))?;
        Ok(high)
    } else {
        Ok(finished)
    }
}

/// One worker owns this row and its serial variants; completed outputs survive later errors.
fn render_target(
    app: &AppHandle, control: &JobControl, tools: &Tools, settings: &MontageSettings,
    pool: &[MediaInfo], target_index: usize, backdrops: &[MediaInfo], intros: &[MediaInfo],
    work_root: &Path, sticker_paths: &[PathBuf],
) -> Result<bool, String> {
    let source = &pool[target_index];
    let mut row = MontageProgress {
        source_path: media::path_arg(&source.path), name: source.path.strip_prefix(&settings.source_dir).unwrap().to_string_lossy().into_owned(),
        status: "processing".into(), stage: "准备混剪".into(), progress: 0.0, completed: 0,
        total: settings.default_copies, output_paths: Vec::new(), error: None,
    };
    if !source.has_audio {
        row.status = "failed".into();
        row.stage = "原声不可用".into();
        row.error = Some("目标爆款没有原声音轨，无法生成保留原声的成片".into());
        update_progress(app, row);
        return Ok(false);
    }
    for _ in 0..settings.default_copies {
        control.check(app)?;
        let rendered = (|| {
            let work = WorkDir::new(work_root)?;
            let private = render_variant(app, control, tools, settings, pool, target_index, backdrops, intros,
                &work.0, sticker_paths, &mut row)?;
            control.check(app)?;
            let stem = source.path.file_stem().unwrap().to_string_lossy();
            publish_numbered(&private, Path::new(&settings.output_dir), &stem)
        })();
        match rendered {
            Ok(target) => {
                row.completed += 1;
                row.output_paths.push(media::path_arg(&target));
                row.progress = row.completed as f64 / row.total as f64 * 100.0;
                row.stage = format!("已完成 {}/{}", row.completed, row.total);
                update_progress(app, row.clone());
            }
            Err(error) => {
                control.check(app)?;
                row.status = "failed".into();
                row.stage = "处理失败".into();
                row.error = Some(error);
                update_progress(app, row);
                return Ok(false);
            }
        }
    }
    row.status = "completed".into();
    row.stage = "完成".into();
    row.progress = 100.0;
    update_progress(app, row);
    Ok(true)
}

/// Only selected paths emit target rows; every valid viral original remains available as a donor.
pub fn run(app: &AppHandle, settings: &MontageSettings, sources: &[PathBuf], targets: &[PathBuf], control: &JobControl) -> Result<(), String> {
    let tools = Tools::discover()?;
    let output_root = Path::new(&settings.output_dir);
    let attribution = crate::data_dir(app).join("video-montage");
    fs::create_dir_all(&attribution).map_err(|error| format!("创建贴纸署名目录失败：{error}"))?;
    fs::write(attribution.join("credits.json"), include_bytes!("../../../assets/video-montage/credits.json"))
        .map_err(|error| format!("写入贴纸署名失败：{error}"))?;
    let shared = WorkDir::new(output_root)?;
    let sticker_paths = stickers(&shared.0)?;
    let selected = targets.iter().cloned().collect::<HashSet<_>>();
    let mut pool = Vec::new();
    let mut failures = 0;
    for path in sources {
        control.check(app)?;
        let mut row = MontageProgress {
            source_path: media::path_arg(path), name: path.strip_prefix(&settings.source_dir).unwrap().to_string_lossy().into_owned(),
            status: "processing".into(), stage: "读取视频信息".into(), progress: 0.0, completed: 0,
            total: settings.default_copies, output_paths: Vec::new(), error: None,
        };
        let is_target = selected.contains(path);
        if is_target {
            update_progress(app, row.clone());
        }
        match media::probe(app, control, &tools, path) {
            Ok(info) => {
                pool.push(info);
                if is_target {
                    row.status = "waiting".into();
                    row.stage = "等待处理".into();
                    update_progress(app, row);
                }
            }
            Err(error) => {
                control.check(app)?;
                if !is_target {
                    return Err(format!("读取补充爆款素材失败：{}：{error}", path.display()));
                }
                failures += 1;
                row.status = "failed".into(); row.stage = "读取失败".into(); row.error = Some(error);
                update_progress(app, row);
            }
        }
    }
    let mut backdrop_paths = Vec::new();
    collect_video_paths(Path::new(&settings.background_dir), "画中画视频", &mut backdrop_paths)?;
    if backdrop_paths.is_empty() {
        return Err("画中画视频目录没有可用视频".into());
    }
    let mut backdrops = Vec::new();
    for path in backdrop_paths {
        let info = media::probe(app, control, &tools, &path)
            .map_err(|error| format!("读取画中画视频失败：{}：{error}", path.display()))?;
        backdrops.push(info);
    }
    let mut intro_paths = Vec::new();
    if !settings.intro_dir.is_empty() {
        collect_video_paths(Path::new(&settings.intro_dir), "前贴", &mut intro_paths)?;
    }
    let mut intros = Vec::new();
    for path in intro_paths {
        intros.push(media::probe(app, control, &tools, &path)?);
    }
    let target_indices = pool.iter().enumerate()
        .filter(|(_, source)| selected.contains(&source.path))
        .map(|(index, _)| index).collect::<Vec<_>>();
    let queue = AtomicUsize::new(0);
    let failures = AtomicUsize::new(failures);
    let workers = (settings.workers as usize).min(target_indices.len());
    thread::scope(|scope| {
        let mut handles = Vec::new();
        let queue = &queue;
        let failures = &failures;
        let target_indices = &target_indices;
        let pool = &pool;
        let tools = &tools;
        let backdrops = &backdrops;
        let intros = &intros;
        let work_root = &shared.0;
        let sticker_paths = &sticker_paths;
        for _ in 0..workers {
            handles.push(scope.spawn(move || -> Result<(), String> {
                loop {
                    control.check(app)?;
                    let position = queue.fetch_add(1, Ordering::Relaxed);
                    let Some(&target_index) = target_indices.get(position) else {
                        return Ok(());
                    };
                    if !render_target(app, control, tools, settings, pool, target_index, backdrops, intros,
                        work_root, sticker_paths)?
                    {
                        failures.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }));
        }
        // Join every worker before propagating any error. Shared media and work paths
        // cannot be dropped while a worker or its cancellable child process is active.
        let mut error = None;
        for handle in handles {
            let result = match handle.join() {
                Ok(result) => result,
                Err(_) => Err("视频混剪工作线程异常".into()),
            };
            if let Err(reason) = result {
                error.get_or_insert(reason);
            }
        }
        match error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    })?;
    let failures = failures.load(Ordering::Relaxed);
    if failures > 0 {
        Err(format!("{failures} 个视频处理失败，请查看对应进度行"))
    } else {
        Ok(())
    }
}
