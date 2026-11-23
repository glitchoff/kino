//! gpucap — render captions offscreen with wgpu 30 + glyphon 0.12.
//!
//! Two modes:
//!
//! - **Single** (`--text ... --out file.png`): one caption, for eyeballing a
//!   preset.
//! - **Batch** (`--manifest jobs.json`): every caption for a composition, in
//!   one process. This is the mode kino uses.
//!
//! Why batch exists: the device, adapter and font system cost ~0.4 s to set
//! up. Rendering one caption per process paid that 297 times on a real chapter
//! and made the whole render *slower* than `drawtext` (396 s against 216 s),
//! even though a single frame costs 1.1 ms. Batch pays it once.
//!
//! The manifest is a JSON array of jobs:
//!
//! ```json
//! [{ "text": "hello", "out": "elem-0.png", "preset": "shout-band",
//!    "font": "C:/.../Anton-Regular.ttf", "highlight": 2 }]
//! ```

use anyhow::{Context, Result};
use clap::Parser;
use glyphon::{
    Attrs, Buffer, Cache, Color as GlyphColor, Family, FontSystem, Metrics, Resolution,
    Shaping, SwashCache, TextArea, TextAtlas, TextBounds, TextRenderer, Viewport, Weight,
};
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Parser, Debug)]
#[command(about = "Render caption text offscreen with a GPU glyph atlas")]
struct Args {
    /// One caption to draw. Ignored when --manifest is given.
    #[arg(long)]
    text: Option<String>,

    /// Batch: a JSON file listing every caption to render.
    #[arg(long)]
    manifest: Option<PathBuf>,

    /// Word index to highlight (karaoke). Negative draws the plain line.
    #[arg(long, default_value_t = -1)]
    highlight: i32,

    /// Font size in pixels.
    #[arg(long, default_value_t = 52.0)]
    size: f32,

    /// Frame width.
    #[arg(long, default_value_t = 720)]
    width: u32,

    /// Frame height.
    #[arg(long, default_value_t = 1280)]
    height: u32,

    /// Path to a TTF/OTF font. When omitted, the system sans-serif is used.
    #[arg(long)]
    font: Option<PathBuf>,

    /// kino caption preset: shout, shout-band, plain, or none.
    #[arg(long, default_value = "none")]
    preset: String,

    /// Stroke width in pixels. `0` draws fill only. Unset uses the preset's.
    #[arg(long)]
    stroke: Option<f32>,

    /// Points around the stroke circle. 16 suits a 5px stroke, 32 a 7px one.
    #[arg(long, default_value_t = 16)]
    stroke_steps: u32,

    /// Output PNG (single mode).
    #[arg(long, default_value = "out/caption.png")]
    out: PathBuf,

    /// Render this many frames and report ms/frame (single mode, timing only).
    #[arg(long, default_value_t = 1)]
    frames: u32,

    /// Highlight every word in turn across `--frames`, like a karaoke pass.
    #[arg(long, default_value_t = false)]
    sweep: bool,

    /// Write every frame as a numbered PNG into this directory.
    #[arg(long)]
    frames_dir: Option<PathBuf>,
}

/// One caption in a batch.
#[derive(Deserialize, Debug)]
struct Job {
    text: String,
    out: String,
    #[serde(default)]
    preset: Option<String>,
    #[serde(default)]
    font: Option<String>,
    #[serde(default)]
    highlight: Option<i32>,
    #[serde(default)]
    stroke: Option<f32>,
}

/// Roughly the shape kino's `shout-band` preset produces.
const OUTLINE: f32 = 5.0;

struct Preset {
    font: &'static str,
    size: f32,
    stroke: f32,
    highlight: (u8, u8, u8),
    centred: bool,
    bottom: f32,
    karaoke: bool,
}

fn preset_for(name: &str) -> Option<Preset> {
    match name {
        "shout" => Some(Preset {
            font: "Anton-Regular.ttf",
            size: 96.0,
            stroke: 7.0,
            highlight: (0xff, 0xff, 0xff),
            centred: true,
            bottom: 0.0,
            karaoke: true,
        }),
        "shout-band" => Some(Preset {
            font: "Anton-Regular.ttf",
            size: 52.0,
            stroke: 5.0,
            highlight: (0xf5, 0xb5, 0x44),
            centred: false,
            bottom: 200.0,
            karaoke: true,
        }),
        "plain" => Some(Preset {
            font: "Inter-Regular.ttf",
            size: 44.0,
            stroke: 3.0,
            highlight: (0xff, 0xff, 0xff),
            centred: false,
            bottom: 120.0,
            karaoke: false,
        }),
        _ => None,
    }
}

/// Everything a batch job needs, resolved.
struct Resolved {
    text: String,
    out: PathBuf,
    font: Option<PathBuf>,
    size: f32,
    stroke: f32,
    highlight: (u8, u8, u8),
    centred: bool,
    bottom: f32,
    karaoke: bool,
    highlight_index: i32,
}

impl Resolved {
    fn from_job(job: &Job, defaults: &Args) -> Self {
        let preset = preset_for(job.preset.as_deref().unwrap_or(&defaults.preset));
        Self {
            text: job.text.clone(),
            out: PathBuf::from(&job.out),
            font: job
                .font
                .as_ref()
                .map(PathBuf::from)
                .or_else(|| defaults.font.clone()),
            size: preset.as_ref().map(|p| p.size).unwrap_or(defaults.size),
            stroke: job
                .stroke
                .or_else(|| preset.as_ref().map(|p| p.stroke))
                .unwrap_or(OUTLINE),
            highlight: preset.as_ref().map(|p| p.highlight).unwrap_or((255, 214, 0)),
            centred: preset.as_ref().map(|p| p.centred).unwrap_or(false),
            bottom: preset.as_ref().map(|p| p.bottom).unwrap_or(200.0),
            karaoke: preset.as_ref().map(|p| p.karaoke).unwrap_or(true),
            highlight_index: job.highlight.unwrap_or(defaults.highlight),
        }
    }

    fn from_args(args: &Args) -> Self {
        Self::from_job(
            &Job {
                text: args.text.clone().unwrap_or_default(),
                out: args.out.to_string_lossy().to_string(),
                preset: None,
                font: None,
                highlight: Some(args.highlight),
                stroke: args.stroke,
            },
            args,
        )
    }
}

/// The GPU state that is expensive to create and worth reusing across captions.
struct Gpu {
    device: wgpu::Device,
    queue: wgpu::Queue,
    view: wgpu::TextureView,
    target: wgpu::Texture,
    format: wgpu::TextureFormat,
    cache: Cache,
    atlas: TextAtlas,
    viewport: Viewport,
    width: u32,
    height: u32,
}

fn main() -> Result<()> {
    let args = Args::parse();
    pollster::block_on(run(args))
}

async fn run(args: Args) -> Result<()> {
    let (width, height) = (args.width, args.height);

    // ---- GPU device (created once, for the whole batch) -------------------
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::new_without_display_handle());

    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
            apply_limit_buckets: false,
        })
        .await
        .context("no suitable GPU adapter found")?;

    eprintln!(
        "[gpucap] adapter: {} ({:?})",
        adapter.get_info().name,
        adapter.get_info().backend
    );

    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("gpucap"),
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::default(),
            experimental_features: wgpu::ExperimentalFeatures::disabled(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        })
        .await
        .context("request_device failed")?;

    let format = wgpu::TextureFormat::Rgba8UnormSrgb;
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("target"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());

    let cache = Cache::new(&device);
    let atlas = TextAtlas::new(&device, &queue, &cache, format);
    let mut viewport = Viewport::new(&device, &cache);
    viewport.update(&queue, Resolution { width, height });

    let mut gpu = Gpu {
        device,
        queue,
        view,
        target,
        format,
        cache,
        atlas,
        viewport,
        width,
        height,
    };

    let mut font_system = FontSystem::new();
    let mut swash_cache = SwashCache::new();

    // ---- resolve the work ------------------------------------------------
    let jobs: Vec<Resolved> = match &args.manifest {
        Some(path) => {
            let raw = std::fs::read_to_string(path)
                .with_context(|| format!("could not read manifest {}", path.display()))?;
            let parsed: Vec<Job> =
                serde_json::from_str(&raw).context("manifest is not a JSON array of jobs")?;
            parsed.iter().map(|j| Resolved::from_job(j, &args)).collect()
        }
        None => vec![Resolved::from_args(&args)],
    };

    if jobs.is_empty() {
        eprintln!("[gpucap] nothing to render");
        return Ok(());
    }

    let started = std::time::Instant::now();
    let mut rendered = 0usize;
    let mut failed = 0usize;

    for (i, job) in jobs.iter().enumerate() {
        match render_one(
            &mut gpu,
            &mut font_system,
            &mut swash_cache,
            job,
            &args,
        ) {
            Ok(()) => rendered += 1,
            Err(err) => {
                failed += 1;
                eprintln!(
                    "[gpucap] job {i} ({}) failed: {err}",
                    job.out.display()
                );
            }
        }
    }

    let elapsed = started.elapsed();
    eprintln!(
        "[gpucap] {rendered} rendered, {failed} failed in {:.0} ms = {:.2} ms/caption",
        elapsed.as_secs_f64() * 1000.0,
        if rendered > 0 {
            elapsed.as_secs_f64() * 1000.0 / rendered as f64
        } else {
            0.0
        },
    );

    if rendered == 0 {
        anyhow::bail!("every job failed");
    }
    Ok(())
}

fn render_one(
    gpu: &mut Gpu,
    font_system: &mut FontSystem,
    swash_cache: &mut SwashCache,
    job: &Resolved,
    args: &Args,
) -> Result<()> {
    let (width, height) = (gpu.width, gpu.height);
    let mut text_renderer = TextRenderer::new(
        &mut gpu.atlas,
        &gpu.device,
        wgpu::MultisampleState::default(),
        None,
    );

    // A font named per job wins over the global one, so one batch can mix
    // Anton and Inter.
    let mut family = Family::SansSerif;
    if let Some(path) = &job.font {
        let bytes = std::fs::read(path)
            .with_context(|| format!("could not read font {}", path.display()))?;
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("custom")
            .to_string();
        font_system
            .db_mut()
            .load_font_source(glyphon::fontdb::Source::Binary(std::sync::Arc::new(bytes)));
        family = Family::Name(Box::leak(name.into_boxed_str()));
    }

    let metrics = Metrics::new(job.size, job.size * 1.2);
    let bounds = TextBounds {
        left: 0,
        top: 0,
        right: width as i32,
        bottom: height as i32,
    };

    let (base_x, base_y) = if job.centred {
        (0.0, height as f32 / 2.0)
    } else {
        (0.0, height as f32 - job.bottom)
    };
    let text_align = glyphon::cosmic_text::Align::Center;

    let mut buffer = Buffer::new(font_system, metrics);
    buffer.set_size(Some(width as f32), None);

    let plain = Attrs::new().family(family).weight(Weight::BOLD);
    let hot = plain
        .clone()
        .color(GlyphColor::rgb(job.highlight.0, job.highlight.1, job.highlight.2));

    // Karaoke: split into word spans, colour the spoken one. The span that is
    // "hot" is fixed here rather than swept — the compiler overlays a still.
    let mut spans: Vec<(String, Attrs)> = Vec::new();
    let mut rest = job.text.as_str();
    let mut word_idx = 0usize;
    while !rest.is_empty() {
        let word_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let after = &rest[word_end..];
        let ws_end = after
            .find(|c: char| !c.is_whitespace())
            .unwrap_or(after.len());
        let chunk = &rest[..word_end + ws_end];

        let is_hot = job.karaoke && job.highlight_index >= 0 && word_idx == job.highlight_index as usize;
        spans.push((
            chunk.to_string(),
            if is_hot { hot.clone() } else { plain.clone() },
        ));

        rest = &rest[word_end + ws_end..];
        word_idx += 1;
    }

    buffer.set_rich_text(
        spans.iter().map(|(s, a)| (s.as_str(), a.clone())),
        &plain,
        Shaping::Advanced,
        Some(text_align),
    );
    buffer.shape_until_scroll(font_system, false);

    // Stroke: the text drawn at N points around a circle of the stroke radius,
    // then the fill on top. Glyphs are already in the atlas, so each extra
    // point is a vertex refill, not a rasterisation — 0.12 ms on a real frame.
    let stroke_buffer = if job.stroke > 0.0 {
        let mut sb = Buffer::new(font_system, metrics);
        sb.set_size(Some(width as f32), None);
        sb.set_text(&job.text, &plain, Shaping::Advanced, Some(text_align));
        sb.shape_until_scroll(font_system, false);
        Some(sb)
    } else {
        None
    };

    let mut areas: Vec<TextArea> = Vec::new();
    if let Some(sb) = &stroke_buffer {
        let steps = args.stroke_steps.max(4);
        for i in 0..steps {
            let angle = (i as f32 / steps as f32) * std::f32::consts::TAU;
            areas.push(TextArea {
                buffer: sb,
                left: base_x + angle.cos() * job.stroke,
                top: base_y + angle.sin() * job.stroke,
                scale: 1.0,
                bounds,
                default_color: GlyphColor::rgb(0, 0, 0),
                custom_glyphs: &[],
            });
        }
    }
    areas.push(TextArea {
        buffer: &buffer,
        left: base_x,
        top: base_y,
        scale: 1.0,
        bounds,
        default_color: GlyphColor::rgb(255, 255, 255),
        custom_glyphs: &[],
    });

    text_renderer
        .prepare(
            &gpu.device,
            &gpu.queue,
            font_system,
            &mut gpu.atlas,
            &gpu.viewport,
            areas,
            swash_cache,
        )
        .context("text prepare failed")?;

    let mut encoder = gpu
        .device
        .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("gpucap") });
    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("caption"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &gpu.view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: 0.0,
                        g: 0.0,
                        b: 0.0,
                        a: 0.0,
                    }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        text_renderer
            .render(&gpu.atlas, &gpu.viewport, &mut pass)
            .context("text render failed")?;
    }

    let unpadded = width * 4;
    let align_bytes = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded = unpadded.div_ceil(align_bytes) * align_bytes;

    let readback = gpu.device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: (padded * height) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    encoder.copy_texture_to_buffer(
        wgpu::TexelCopyTextureInfo {
            texture: &gpu.target,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::TexelCopyBufferInfo {
            buffer: &readback,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(padded),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );

    gpu.queue.submit(Some(encoder.finish()));

    let slice = readback.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    gpu.device
        .poll(wgpu::PollType::Wait {
            submission_index: None,
            timeout: None,
        })
        .context("device poll failed")?;
    rx.recv()
        .context("map channel closed")?
        .context("map failed")?;

    let data = slice.get_mapped_range().context("mapped range failed")?;
    let mut pixels = Vec::with_capacity((unpadded * height) as usize);
    for row in 0..height {
        let start = (row * padded) as usize;
        pixels.extend_from_slice(&data[start..start + unpadded as usize]);
    }
    drop(data);
    readback.unmap();

    if let Some(parent) = job.out.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let img = image::RgbaImage::from_raw(width, height, pixels)
        .context("pixel buffer had the wrong size")?;
    img.save(&job.out)
        .with_context(|| format!("could not write {}", job.out.display()))?;

    Ok(())
}

/// Kept for the single-caption timing mode.
#[allow(dead_code)]
fn report_path(p: &Path) -> String {
    p.display().to_string()
}
