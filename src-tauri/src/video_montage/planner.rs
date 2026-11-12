//! AI module map
//! Purpose: slice original-video ranges, budget accelerated pictures, and draw TUI-style effects.
//! Entry: engine.rs requests one independent plan per target/copy and one backdrop effect.
//! Flow: A's nonoverlapping ranges are used first; other originals supply the measured
//! post-speed deficit, then the complete shot list is shuffled into its final order.
//! Invariants: source intervals are never looped or repeated to fill the body. The sum
//! of integer output-frame budgets equals the target's rounded 30-FPS duration.

use super::media::MediaInfo;
use uuid::Uuid;

pub const FPS: f64 = 30.0;
pub const WIDTH: u32 = 720;
pub const HEIGHT: u32 = 1280;

pub struct Random(u64);

impl Random {
    pub fn new() -> Self {
        let value = Uuid::new_v4().as_u128();
        Self((value as u64) ^ ((value >> 64) as u64) | 1)
    }
    pub fn unit(&mut self) -> f64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 >> 11) as f64 / ((1u64 << 53) as f64)
    }
    pub fn range(&mut self, low: f64, high: f64) -> f64 {
        low + self.unit() * (high - low)
    }
    pub fn index(&mut self, length: usize) -> usize {
        (self.unit() * length as f64) as usize
    }
    pub fn signed(&mut self, low: f64, high: f64) -> f64 {
        let value = self.range(low, high);
        if self.unit() < 0.5 { -value } else { value }
    }
    pub fn shuffle<T>(&mut self, values: &mut [T]) {
        for index in (1..values.len()).rev() {
            let other = self.index(index + 1);
            values.swap(index, other);
        }
    }
}

#[derive(Clone)]
pub struct Effects {
    pub mirror: bool,
    pub crop: u32,
    pub zoom: f64,
    pub rotation: f64,
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub hue: f64,
    pub gains: [f64; 3],
    pub noise: u32,
    pub sharpen: f64,
    pub sticker: usize,
    pub corner: usize,
}

impl Effects {
    pub fn draw(random: &mut Random) -> Self {
        // Retain TUI's original discrete crop draw before its upper-half strengthening.
        let raw_crop = random.range(3.0, 8.0).round() as u32;
        let even_crop = (raw_crop + raw_crop % 2).min(8);
        let crop = ((((even_crop + 8) as f64 / 4.0).ceil() as u32) * 2).min(8);
        // Channels share one drift magnitude in TUI; independent fixed-minimum draws
        // over-weight large changes and do not reproduce that color distribution.
        let drift = (random.range(0.0, 0.012) * 10000.0).round() / 10000.0;
        let mut channel_gains: [f64; 3] = std::array::from_fn(|_| {
            ((1.0 + random.range(-drift, drift)) * 10000.0).round() / 10000.0
        });
        if channel_gains.iter().all(|gain| (*gain - 1.0).abs() < 1e-9) {
            channel_gains[0] = ((1.0 + drift) * 10000.0).round() / 10000.0;
        }
        let gains = channel_gains.map(|gain| {
            let adjusted = 1.0 + (((gain - 1.0).abs() + 0.012) / 2.0).copysign(gain - 1.0);
            (adjusted * 10000.0).round() / 10000.0
        });
        Self {
            mirror: random.unit() < 0.35,
            crop,
            zoom: random.range(1.02, 1.03),
            rotation: random.signed(0.55, 0.8),
            brightness: random.signed(0.006, 0.012),
            contrast: random.range(1.02, 1.03),
            saturation: random.range(1.035, 1.05),
            hue: random.signed(1.5, 3.0),
            gains,
            noise: if random.unit() < 0.5 { 5 } else { 6 },
            sharpen: random.range(0.55, 0.8),
            sticker: random.index(3),
            corner: [3, 2, 0][random.index(3)],
        }
    }

    /// Input is already fitted to the 720x1280 canvas; restore it after geometry changes.
    pub fn filters(&self) -> String {
        let radians = self.rotation.to_radians();
        let sine = radians.sin().abs();
        let cosine = radians.cos().abs();
        let even = |value: f64| (value.floor() as u32 / 2) * 2;
        let inner_width = even(WIDTH as f64 * cosine - HEIGHT as f64 * sine);
        let inner_height = even(HEIGHT as f64 * cosine - WIDTH as f64 * sine);
        let crop_width = even(((inner_width as f64 * self.zoom).floor()).min((WIDTH - self.crop * 2) as f64));
        let crop_height = even(((inner_height as f64 * self.zoom).floor()).min((HEIGHT - self.crop * 2) as f64));
        let mirror = if self.mirror { "hflip," } else { "" };
        format!(
            "{mirror}rotate={radians:.8}:c=black,crop={inner_width}:{inner_height}:(iw-{inner_width})/2:(ih-{inner_height})/2,scale=iw*{zoom:.6}:ih*{zoom:.6},crop={crop_width}:{crop_height}:(iw-{crop_width})/2:(ih-{crop_height})/2,scale={WIDTH}:{HEIGHT},setsar=1,eq=brightness={brightness:.6}:contrast={contrast:.6}:saturation={saturation:.6},hue=h={hue:.6},colorchannelmixer=rr={red:.6}:gg={green:.6}:bb={blue:.6},noise=alls={noise}:allf=t+u,unsharp=luma_amount={sharpen:.6}:luma_msize_x=3:luma_msize_y=3",
            zoom=self.zoom,brightness=self.brightness,contrast=self.contrast,saturation=self.saturation,
            hue=self.hue,red=self.gains[0],green=self.gains[1],blue=self.gains[2],noise=self.noise,sharpen=self.sharpen,
        )
    }
}

pub struct Shot {
    pub source: usize,
    pub offset: f64,
    pub speed: f64,
    pub frames: u64,
    pub effects: Effects,
}

fn ranges(duration: f64, random: &mut Random) -> Vec<(f64, f64)> {
    let mut result = Vec::new();
    let mut start = 0.0;
    while start < duration {
        let remaining = duration - start;
        let mut length = random.range(3.0, 6.0).min(remaining);
        if remaining - length < 1.2 {
            length = remaining;
        }
        result.push((start, length));
        start += length;
    }
    result
}

pub fn plan(pool: &[MediaInfo], target: usize, random: &mut Random) -> Result<Vec<Shot>, String> {
    let target_frames = (pool[target].duration * FPS).round() as u64;
    let mut remaining = target_frames;
    let mut shots = Vec::new();
    let mut sources = (0..pool.len()).filter(|index| *index != target).collect::<Vec<_>>();
    random.shuffle(&mut sources);
    sources.insert(0, target);
    for source in sources {
        let mut slices = ranges(pool[source].duration, random);
        random.shuffle(&mut slices);
        for (offset, length) in slices {
            let speed = random.range(1.0, 1.5);
            // Leave one source-frame of decode margin inside the cut; no repeated tail is generated.
            let available = ((length - 1.0 / FPS).max(0.0) / speed * FPS).floor() as u64;
            let frames = available.min(remaining);
            if frames == 0 {
                continue;
            }
            shots.push(Shot { source, offset, speed, frames, effects: Effects::draw(random) });
            remaining -= frames;
            if remaining == 0 {
                random.shuffle(&mut shots);
                return Ok(shots);
            }
        }
    }
    Err(format!("其他爆款素材不足，目标视频加速后还缺 {:.2} 秒，请添加其他爆款视频", remaining as f64 / FPS))
}
