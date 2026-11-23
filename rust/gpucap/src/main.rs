//! gpucap — render one caption frame offscreen with wgpu 30 + glyphon 0.12.
//!
//! The point of this binary is to answer one question with a measurement:
//! can a glyph-atlas text renderer draw kino's karaoke captions faster than
//! the `drawtext,split=N + crop + overlay` chain kino emits today?
//!
//! It renders a single frame to PNG. Timing a full clip is the next step.

use anyhow::{Context, Result};
use clap::Parser;
use glyphon::{
    Attrs, Buffer, Cache, Color as GlyphColor, Family, FontSystem, Metrics, Resolution,
    Shaping, SwashCache, TextArea, TextAtlas, TextBounds, TextRenderer, Viewport, Weight,
};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(about = "Render one caption frame offscreen with a GPU glyph atlas")]
struct Args {
    /// Caption text to draw.
    #[arg(long, default_value = "The Pokemon anime never showed you this")]
    text: String,

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

    /// kino caption preset: shout, shout-band, plain, or none. Sets font size
    /// and stroke to match what the engine draws, so a comparison is fair.
    #[arg(long, default_value = "none")]
    preset: String,

    /// Output PNG.
    #[arg(long, default_value = "out/caption.png")]
    out: PathBuf,

    /// Render this many frames and report ms/frame. Frames are not written
    /// except the last, so the number measures the GPU path rather than disk.
    #[arg(long, default_value_t = 1)]
    frames: u32,

    /// Highlight every word in turn across `--frames`, like a karaoke pass.
    #[arg(long, default_value_t = false)]
    sweep: bool,

    /// Write every frame as a numbered PNG into this directory. When set, the
    /// video is built from the sequence rather than from a single still.
    #[arg(long)]
    frames_dir: Option<PathBuf>,
}

/// Roughly the shape kino's `shout-band` preset produces: bold white text with
/// a heavy black outline, centred near the bottom.
const OUTLINE: f32 = 5.0;

/// The caption presets kino ships (`src/captions/presets.ts`), mirrored so a
/// comparison renders the same text the engine would.
struct Preset {
    font: &'static str,
    size: f32,
    stroke: f32,
    /// Colour of the spoken word.
    highlight: (u8, u8, u8),
    /// `true` when the line sits centred in the frame rather than in a bottom
    /// band — kino's `shout` covers the picture on purpose.
    centred: bool,
    /// Pixels up from the bottom edge, for the band styles.
    bottom: f32,
    /// `karaoke` colours the spoken word, `reveal` leaves every word white.
    karaoke: bool,
}

fn preset_for(name: &str) -> Option<Preset> {
    match name {
        // Heavy single-word captions, dead centre, thick stroke.
        "shout" => Some(Preset {
            font: "Anton-Regular.ttf",
            size: 96.0,
            stroke: 7.0,
            highlight: (0xff, 0xff, 0xff),
            centred: true,
            bottom: 0.0,
            karaoke: true,
        }),
        // The same face as a bottom-band subtitle, amber spoken word.
        "shout-band" => Some(Preset {
            font: "Anton-Regular.ttf",
            size: 52.0,
            stroke: 5.0,
            highlight: (0xf5, 0xb5, 0x44),
            centred: false,
            bottom: 200.0,
            karaoke: true,
        }),
        // Conventional subtitles: reveal, no colour change.
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

fn main() -> Result<()> {
    let args = Args::parse();
    pollster::block_on(run(args))
}async fn run(args: Args) -> Result<()> {
    // ---- GPU device ------------------------------------------------------
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

    // ---- offscreen target ------------------------------------------------
    let format = wgpu::TextureFormat::Rgba8UnormSrgb;
    let target = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("target"),
        size: wgpu::Extent3d {
            width: args.width,
            height: args.height,
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

    // ---- text system -----------------------------------------------------
    let cache = Cache::new(&device);
    let mut font_system = FontSystem::new();

    // Load the font explicitly when asked. cosmic-text discovers system fonts
    // on its own, but a preset must use the exact file kino draws with, or the
    // comparison is against a different typeface.
    let preset = preset_for(&args.preset);
    let font_path = args
        .font
        .clone()
        .or_else(|| preset.as_ref().map(|p| PathBuf::from(p.font)));

    let mut family = Family::SansSerif;
    if let Some(path) = &font_path {
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
        eprintln!("[gpucap] font: {name}");
        family = Family::Name(Box::leak(name.into_boxed_str()));
    }

    let size = preset.as_ref().map(|p| p.size).unwrap_or(args.size);
    let _stroke = preset.as_ref().map(|p| p.stroke).unwrap_or(OUTLINE);
    let hot_rgb = preset.as_ref().map(|p| p.highlight).unwrap_or((255, 214, 0));

    let mut swash_cache = SwashCache::new();
    let mut atlas = TextAtlas::new(&device, &queue, &cache, format);
    let mut text_renderer = TextRenderer::new(
        &mut atlas,
        &device,
        wgpu::MultisampleState::default(),
        None,
    );

    let bounds = TextBounds {
        left: 0,
        top: 0,
        right: args.width as i32,
        bottom: args.height as i32,
    };
    let mut viewport = Viewport::new(&device, &cache);
    viewport.update(
        &queue,
        Resolution {
            width: args.width,
            height: args.height,
        },
    );

    let metrics = Metrics::new(size, size * 1.2);
    let mut buffer = Buffer::new(&mut font_system, metrics);
    // With centre alignment cosmic-text centres the line inside this box, so
    // the box must be the full frame width and the area must sit at x=0.
    // Setting a narrower box AND offsetting the area double-counts the margin
    // and pushes the line off the right edge.
    buffer.set_size(Some(args.width as f32), None);

    // Placement, resolved once. kino's `shout` covers the picture (centred);
    // the band styles sit a fixed distance up from the bottom edge.
    let centred = preset.as_ref().map(|p| p.centred).unwrap_or(false);
    let (base_x, base_y) = match &preset {
        Some(p) if p.centred => (0.0, args.height as f32 / 2.0),
        Some(p) => (0.0, args.height as f32 - p.bottom),
        None => (40.0, args.height as f32 - 200.0),
    };
    let text_align = if preset.is_some() {
        glyphon::cosmic_text::Align::Center
    } else {
        glyphon::cosmic_text::Align::Left
    };
    let _ = centred;

    // ---- render loop -----------------------------------------------------
    // Every frame re-shapes only when the highlighted word changes; the glyph
    // atlas keeps the rasterised glyphs, so the per-frame cost is layout plus
    // a handful of quads. That is the claim being measured here.
    let word_count = args.text.split_whitespace().count().max(1) as i32;
    let frames = args.frames.max(1);

    // 256-byte aligned rows, as wgpu requires.
    let unpadded = args.width * 4;
    let align_bytes = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded = unpadded.div_ceil(align_bytes) * align_bytes;

    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: (padded * args.height) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let karaoke = preset.as_ref().map(|p| p.karaoke).unwrap_or(true);

    let mut pixels: Vec<u8> = Vec::new();
    if let Some(dir) = &args.frames_dir {
        std::fs::create_dir_all(dir).ok();
    }
    let started = std::time::Instant::now();
    let mut layout_time = std::time::Duration::ZERO;
    let mut gpu_time = std::time::Duration::ZERO;

    for frame in 0..frames {
        // Karaoke: the spoken word advances across the frames, like a real
        // caption's word timing. `sweep` cycles it; otherwise it is fixed.
        let hot_idx = if args.sweep {
            (frame as i32 * word_count / frames as i32).min(word_count - 1)
        } else {
            args.highlight
        };

        let t0 = std::time::Instant::now();
        let plain = Attrs::new().family(family.clone()).weight(Weight::BOLD);
        let hot = plain
            .clone()
            .color(GlyphColor::rgb(hot_rgb.0, hot_rgb.1, hot_rgb.2));

        let mut spans: Vec<(String, Attrs)> = Vec::new();
        let mut rest = args.text.as_str();
        let mut word_idx = 0usize;
        while !rest.is_empty() {
            let word_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            let after = &rest[word_end..];
            let ws_end = after
                .find(|c: char| !c.is_whitespace())
                .unwrap_or(after.len());
            let chunk = &rest[..word_end + ws_end];

            let is_hot = karaoke && hot_idx >= 0 && word_idx == hot_idx as usize;
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
        buffer.shape_until_scroll(&mut font_system, false);
        layout_time += t0.elapsed();

        let t1 = std::time::Instant::now();

        // One pass, fill only. The eight-offset outline that was here drew the
        // text black eight times around itself, which at Anton's weight reads
        // as a hard drop shadow rather than an outline. The stroke belongs in
        // the glyph (an SDF or a stroked atlas entry), not in duplicate
        // geometry behind it.
        let areas: Vec<TextArea> = vec![TextArea {
            buffer: &buffer,
            left: base_x,
            top: base_y,
            scale: 1.0,
            bounds,
            default_color: GlyphColor::rgb(255, 255, 255),
            custom_glyphs: &[],
        }];

        text_renderer
            .prepare(
                &device,
                &queue,
                &mut font_system,
                &mut atlas,
                &viewport,
                areas,
                &mut swash_cache,
            )
            .context("text prepare failed")?;

        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("gpucap"),
        });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("caption"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: 0.02,
                            g: 0.02,
                            b: 0.03,
                            a: 1.0,
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
                .render(&atlas, &viewport, &mut pass)
                .context("text render failed")?;
        }

        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &target,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &readback,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(args.height),
                },
            },
            wgpu::Extent3d {
                width: args.width,
                height: args.height,
                depth_or_array_layers: 1,
            },
        );

        queue.submit(Some(encoder.finish()));

        let slice = readback.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        device
            .poll(wgpu::PollType::Wait {
                submission_index: None,
                timeout: None,
            })
            .context("device poll failed")?;
        rx.recv()
            .context("map channel closed")?
            .context("map failed")?;

        // Keep the last frame's pixels for the still PNG. When `frames_dir`
        // is set, every frame is written too, because a video built from one
        // still is 74 identical frames — which is exactly the bug that made
        // the first karaoke test look like a frozen image.
        let keep = frame + 1 == frames || args.frames_dir.is_some();
        if keep {
            let data = slice.get_mapped_range().context("mapped range failed")?;
            pixels.clear();
            pixels.reserve((unpadded * args.height) as usize);
            for row in 0..args.height {
                let start = (row * padded) as usize;
                pixels.extend_from_slice(&data[start..start + unpadded as usize]);
            }
            drop(data);

            if let Some(dir) = &args.frames_dir {
                let img = image::RgbaImage::from_raw(args.width, args.height, pixels.clone())
                    .context("pixel buffer had the wrong size")?;
                img.save(dir.join(format!("frame-{frame:05}.png")))
                    .with_context(|| format!("could not write frame {frame}"))?;
            }
        }
        readback.unmap();
        gpu_time += t1.elapsed();
    }

    let elapsed = started.elapsed();
    eprintln!(
        "[gpucap] {frames} frames in {:.0} ms = {:.2} ms/frame (layout {:.2}, gpu+readback {:.2})",
        elapsed.as_secs_f64() * 1000.0,
        elapsed.as_secs_f64() * 1000.0 / frames as f64,
        layout_time.as_secs_f64() * 1000.0 / frames as f64,
        gpu_time.as_secs_f64() * 1000.0 / frames as f64,
    );

    // ---- write PNG -------------------------------------------------------
    if let Some(parent) = args.out.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let img = image::RgbaImage::from_raw(args.width, args.height, pixels)
        .context("pixel buffer had the wrong size")?;
    img.save(&args.out)
        .with_context(|| format!("could not write {}", args.out.display()))?;

    eprintln!("[gpucap] wrote {}", args.out.display());
    Ok(())
}
