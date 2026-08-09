use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Cursor, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use bytes::Bytes;
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use img_parts::{jpeg::Jpeg, webp::WebP, ImageICC};
use mozjpeg_rs::{Encoder as JpegEncoder, Preset as JpegPreset, Subsampling};
use serde::{Deserialize, Serialize};
use tauri::{
    ipc::{Channel, Response},
    State,
};

const MAX_ITEMS: usize = 10_000;
const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_PIXELS: u64 = 64_000_000;
const MAX_DECODED_BYTES: u64 = MAX_PIXELS * 4;
const THUMBNAIL_MAX_EDGE: u32 = 320;
const LOSSY_QUALITY: u8 = 88;
const PNG_MAX_COLORS: u32 = 256;
const PNG_QUANTIZATION_SPEED: i32 = 6;
const PNG_DITHERING: f32 = 0.5;
const CANCELLED_ERROR: &str = "压缩已取消。";

#[derive(Default)]
pub struct CompressionState {
    sessions: Mutex<HashMap<String, Arc<CompressionSession>>>,
    sequence: AtomicU64,
}

struct CompressionSession {
    source_root: Option<PathBuf>,
    items: Vec<NativeSourceItem>,
    source_paths: HashSet<PathBuf>,
    temp_root: PathBuf,
    results: Mutex<HashMap<String, CachedOutput>>,
    work_lock: Mutex<()>,
    cancelled: AtomicBool,
    running: AtomicBool,
}

impl Drop for CompressionSession {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.temp_root);
    }
}

#[derive(Clone)]
struct CachedOutput {
    path: PathBuf,
    size: u64,
}

#[derive(Clone)]
struct NativeSourceItem {
    id: String,
    source_path: PathBuf,
    relative_path: PathBuf,
    format: CompressionFormat,
    width: u32,
    height: u32,
    size: u64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CompressionInputMode {
    Files,
    Folder,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CompressionFormat {
    Png,
    Jpeg,
    Webp,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CompressionConflictPolicy {
    Skip,
    Overwrite,
    Rename,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionSettings {
    conflict_policy: CompressionConflictPolicy,
    skip_no_benefit: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionSourceItem {
    id: String,
    relative_path: String,
    format: CompressionFormat,
    width: u32,
    height: u32,
    size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionPreparedSession {
    session_id: String,
    input_mode: CompressionInputMode,
    source_name: String,
    items: Vec<CompressionSourceItem>,
    rejected_count: usize,
    total_bytes: u64,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompressionSummary {
    total: usize,
    succeeded: usize,
    no_benefit: usize,
    skipped: usize,
    failed: usize,
    cancelled: usize,
    original_bytes: u64,
    output_bytes: u64,
    saved_bytes: u64,
    was_cancelled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionSaveItem {
    item_id: String,
    status: String,
    output_relative_path: Option<String>,
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompressionSaveSummary {
    saved: usize,
    skipped: usize,
    failed: usize,
    items: Vec<CompressionSaveItem>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CompressionProgressEvent {
    Started {
        total: usize,
    },
    ItemStarted {
        item_id: String,
        index: usize,
        total: usize,
        relative_path: String,
    },
    ItemFinished {
        item_id: String,
        index: usize,
        status: String,
        output_relative_path: Option<String>,
        output_size: Option<u64>,
        saved_percent: Option<f64>,
        message: Option<String>,
    },
    Finished {
        summary: CompressionSummary,
    },
}

#[tauri::command]
pub async fn compression_prepare(
    state: State<'_, CompressionState>,
    input_mode: CompressionInputMode,
    input_paths: Vec<String>,
    existing_session_id: Option<String>,
    existing_item_ids: Option<Vec<String>>,
) -> Result<CompressionPreparedSession, String> {
    if input_paths.is_empty() {
        return Err("请选择要压缩的图片或文件夹。".into());
    }

    let (source_root, candidates, source_name, mut rejected_count) = match input_mode {
        CompressionInputMode::Files => {
            let mut candidates = Vec::new();
            let mut rejected = 0;
            for path in input_paths {
                let path = PathBuf::from(path);
                match validate_selected_file(&path) {
                    Ok(path) => candidates.push((path.clone(), file_name_path(&path))),
                    Err(_) => rejected += 1,
                }
            }
            (None, candidates, "已选图片".to_string(), rejected)
        }
        CompressionInputMode::Folder => {
            if input_paths.len() != 1 {
                return Err("文件夹模式每次只能选择一个源文件夹。".into());
            }
            let root = canonical_directory(Path::new(&input_paths[0]))?;
            let source_name = root
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("源文件夹")
                .to_string();
            let mut candidates = Vec::new();
            let mut rejected = 0;
            scan_folder(&root, &root, &mut candidates, &mut rejected)?;
            (Some(root), candidates, source_name, rejected)
        }
    };

    let retained_ids = existing_item_ids
        .unwrap_or_default()
        .into_iter()
        .collect::<HashSet<_>>();
    let mut items = if input_mode == CompressionInputMode::Files {
        existing_session_id
            .as_ref()
            .and_then(|session_id| state.sessions.lock().ok()?.get(session_id).cloned())
            .filter(|session| !session.running.load(Ordering::SeqCst))
            .map(|session| {
                session
                    .items
                    .iter()
                    .filter(|item| retained_ids.contains(&item.id))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let mut seen = items
        .iter()
        .map(|item| item.source_path.clone())
        .collect::<HashSet<_>>();
    let item_nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    for (source_path, relative_path) in candidates {
        if items.len() >= MAX_ITEMS {
            rejected_count += 1;
            continue;
        }
        if !seen.insert(source_path.clone()) {
            continue;
        }
        let item_id = format!("item-{item_nonce}-{}", items.len());
        match inspect_source(&source_path, &relative_path, item_id) {
            Ok(item) => items.push(item),
            Err(_) => rejected_count += 1,
        }
    }

    if items.is_empty() {
        return Err("没有找到可压缩的静态 PNG、JPEG 或 WebP 图片。".into());
    }

    let total_bytes = items.iter().map(|item| item.size).sum();
    let source_paths = items
        .iter()
        .map(|item| item.source_path.clone())
        .collect::<HashSet<_>>();
    let session_id = new_session_id(&state);
    let temp_root = create_session_temp_root(&session_id)?;
    let response_items = items
        .iter()
        .map(|item| CompressionSourceItem {
            id: item.id.clone(),
            relative_path: relative_path_string(&item.relative_path),
            format: item.format,
            width: item.width,
            height: item.height,
            size: item.size,
        })
        .collect();

    let session = Arc::new(CompressionSession {
        source_root,
        items,
        source_paths,
        temp_root,
        results: Mutex::new(HashMap::new()),
        work_lock: Mutex::new(()),
        cancelled: AtomicBool::new(false),
        running: AtomicBool::new(false),
    });
    state
        .sessions
        .lock()
        .map_err(|_| "压缩会话状态不可用。".to_string())?
        .insert(session_id.clone(), session);

    Ok(CompressionPreparedSession {
        session_id,
        input_mode,
        source_name,
        items: response_items,
        rejected_count,
        total_bytes,
    })
}

#[tauri::command]
pub async fn compression_run(
    state: State<'_, CompressionState>,
    session_id: String,
    item_ids: Vec<String>,
    settings: CompressionSettings,
    on_progress: Channel<CompressionProgressEvent>,
) -> Result<CompressionSummary, String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "压缩会话状态不可用。".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "压缩会话已失效，请重新添加图片。".to_string())?;

    if session.running.swap(true, Ordering::SeqCst) {
        return Err("当前压缩任务仍在运行。".into());
    }
    session.cancelled.store(false, Ordering::SeqCst);

    let task_session = session.clone();
    let selected_ids = item_ids.into_iter().collect::<HashSet<_>>();
    if selected_ids.is_empty() {
        session.running.store(false, Ordering::SeqCst);
        return Err("没有可压缩的图片。".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_session(
            &session_id,
            &task_session,
            &selected_ids,
            &settings,
            &on_progress,
        )
    })
    .await;
    session.running.store(false, Ordering::SeqCst);
    result.map_err(|error| format!("压缩任务异常结束：{error}"))?
}

#[tauri::command]
pub async fn compression_save(
    state: State<'_, CompressionState>,
    session_id: String,
    item_ids: Vec<String>,
    output_root: String,
    settings: CompressionSettings,
) -> Result<CompressionSaveSummary, String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "压缩会话状态不可用。".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "压缩会话已失效，请重新添加图片。".to_string())?;
    if session.running.swap(true, Ordering::SeqCst) {
        return Err("当前压缩任务仍在运行。".into());
    }

    let output_root = match validate_output_root(&session, Path::new(&output_root)) {
        Ok(path) => path,
        Err(error) => {
            session.running.store(false, Ordering::SeqCst);
            return Err(error);
        }
    };
    let selected_ids = item_ids.into_iter().collect::<HashSet<_>>();
    if selected_ids.is_empty() {
        session.running.store(false, Ordering::SeqCst);
        return Err("没有可保存的压缩结果。".into());
    }

    let task_session = session.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        save_session(
            &session_id,
            &task_session,
            &selected_ids,
            &output_root,
            settings.conflict_policy,
        )
    })
    .await;
    session.running.store(false, Ordering::SeqCst);
    result.map_err(|error| format!("保存任务异常结束：{error}"))?
}

#[tauri::command]
pub async fn compression_thumbnail(
    state: State<'_, CompressionState>,
    session_id: String,
    item_id: String,
) -> Result<Response, String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "压缩会话状态不可用。".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "压缩会话已失效，请重新添加图片。".to_string())?;
    let item = session
        .items
        .iter()
        .find(|item| item.id == item_id)
        .cloned()
        .ok_or_else(|| "图片已不在当前压缩会话中。".to_string())?;

    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let _guard = session
            .work_lock
            .lock()
            .map_err(|_| "图片处理状态不可用。".to_string())?;
        create_thumbnail(&item)
    })
    .await
    .map_err(|error| format!("缩略图任务异常结束：{error}"))??;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn compression_cancel(
    state: State<'_, CompressionState>,
    session_id: String,
) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "压缩会话状态不可用。".to_string())?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| "压缩会话已失效。".to_string())?;
    session.cancelled.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn compression_release(
    state: State<'_, CompressionState>,
    session_id: String,
) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "压缩会话状态不可用。".to_string())?
        .remove(&session_id);
    if let Some(session) = session {
        session.cancelled.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn run_session(
    session_id: &str,
    session: &CompressionSession,
    selected_ids: &HashSet<String>,
    settings: &CompressionSettings,
    progress: &Channel<CompressionProgressEvent>,
) -> Result<CompressionSummary, String> {
    let selected_items = session
        .items
        .iter()
        .filter(|item| selected_ids.contains(&item.id))
        .collect::<Vec<_>>();
    if selected_items.len() != selected_ids.len() {
        return Err("部分图片已不在当前压缩会话中。".into());
    }
    let total = selected_items.len();
    let mut summary = CompressionSummary {
        total,
        ..CompressionSummary::default()
    };
    let _ = progress.send(CompressionProgressEvent::Started { total });

    for (index, item) in selected_items.iter().enumerate() {
        if session.cancelled.load(Ordering::SeqCst) {
            summary.cancelled = total - index;
            summary.was_cancelled = true;
            break;
        }
        let relative_path = relative_path_string(&item.relative_path);
        let _ = progress.send(CompressionProgressEvent::ItemStarted {
            item_id: item.id.clone(),
            index,
            total,
            relative_path,
        });

        let outcome = match session.work_lock.lock() {
            Ok(_guard) => process_item(session_id, session, item, settings),
            Err(_) => Err("图片处理状态不可用。".into()),
        };
        let mut stop_after_item = false;
        let (status, output_relative_path, output_size, saved_percent, message) = match outcome {
            Ok(ItemOutcome::Succeeded {
                size,
                output_relative_path,
            }) => {
                summary.succeeded += 1;
                summary.original_bytes += item.size;
                summary.output_bytes += size;
                (
                    "succeeded",
                    Some(output_relative_path),
                    Some(size),
                    saved_percent(item.size, size),
                    None,
                )
            }
            Ok(ItemOutcome::NoBenefit { size, message }) => {
                summary.no_benefit += 1;
                (
                    "noBenefit",
                    None,
                    Some(size),
                    saved_percent(item.size, size),
                    Some(message),
                )
            }
            Ok(ItemOutcome::Cancelled) => {
                summary.cancelled = total - index;
                summary.was_cancelled = true;
                stop_after_item = true;
                ("cancelled", None, None, None, Some(CANCELLED_ERROR.into()))
            }
            Err(message) => {
                summary.failed += 1;
                ("failed", None, None, None, Some(message))
            }
        };
        let _ = progress.send(CompressionProgressEvent::ItemFinished {
            item_id: item.id.clone(),
            index,
            status: status.into(),
            output_relative_path,
            output_size,
            saved_percent,
            message,
        });
        if stop_after_item {
            break;
        }
    }

    summary.saved_bytes = summary.original_bytes.saturating_sub(summary.output_bytes);
    let _ = progress.send(CompressionProgressEvent::Finished {
        summary: summary.clone(),
    });
    Ok(summary)
}

fn save_session(
    session_id: &str,
    session: &CompressionSession,
    selected_ids: &HashSet<String>,
    output_root: &Path,
    conflict_policy: CompressionConflictPolicy,
) -> Result<CompressionSaveSummary, String> {
    let selected_items = session
        .items
        .iter()
        .filter(|item| selected_ids.contains(&item.id))
        .collect::<Vec<_>>();
    if selected_items.len() != selected_ids.len() {
        return Err("部分图片已不在当前压缩会话中。".into());
    }
    let cached = session
        .results
        .lock()
        .map_err(|_| "压缩结果状态不可用。".to_string())?
        .clone();
    let mut summary = CompressionSaveSummary::default();

    for item in selected_items {
        let outcome = (|| {
            let result = cached
                .get(&item.id)
                .ok_or_else(|| "压缩结果不存在，请重新压缩。".to_string())?;
            let cached_size = fs::metadata(&result.path)
                .map_err(|error| format!("无法读取压缩结果：{error}"))?
                .len();
            if cached_size != result.size {
                return Err("压缩结果已损坏，请重新压缩。".into());
            }
            validate_relative_path(&item.relative_path)?;
            validate_output_ancestors(output_root, &item.relative_path)?;
            let requested_path = output_root.join(&item.relative_path);
            let output_path = resolve_safe_output_path(session, &requested_path, conflict_policy)?;
            let Some(output_path) = output_path else {
                return Ok(None);
            };
            atomic_copy(
                &result.path,
                &output_path,
                session_id,
                &item.id,
                conflict_policy == CompressionConflictPolicy::Overwrite,
            )?;
            let relative_path = output_path
                .strip_prefix(output_root)
                .map(relative_path_string)
                .map_err(|_| "输出路径越过了所选输出文件夹。".to_string())?;
            Ok(Some(relative_path))
        })();

        match outcome {
            Ok(Some(output_relative_path)) => {
                summary.saved += 1;
                summary.items.push(CompressionSaveItem {
                    item_id: item.id.clone(),
                    status: "saved".into(),
                    output_relative_path: Some(output_relative_path),
                    message: None,
                });
            }
            Ok(None) => {
                summary.skipped += 1;
                summary.items.push(CompressionSaveItem {
                    item_id: item.id.clone(),
                    status: "skipped".into(),
                    output_relative_path: None,
                    message: Some("同名文件已存在".into()),
                });
            }
            Err(message) => {
                summary.failed += 1;
                summary.items.push(CompressionSaveItem {
                    item_id: item.id.clone(),
                    status: "failed".into(),
                    output_relative_path: None,
                    message: Some(message),
                });
            }
        }
    }
    Ok(summary)
}

enum ItemOutcome {
    Succeeded {
        size: u64,
        output_relative_path: String,
    },
    NoBenefit {
        size: u64,
        message: String,
    },
    Cancelled,
}

fn process_item(
    session_id: &str,
    session: &CompressionSession,
    item: &NativeSourceItem,
    settings: &CompressionSettings,
) -> Result<ItemOutcome, String> {
    validate_relative_path(&item.relative_path)?;
    let input = fs::read(&item.source_path).map_err(|error| format!("无法读取原文件：{error}"))?;
    if input.len() as u64 > MAX_FILE_BYTES {
        return Err("文件超过 256 MiB 限制。".into());
    }
    let output = match encode_lossy(&input, item.format, &session.cancelled) {
        Ok(output) => output,
        Err(error) if error == CANCELLED_ERROR => return Ok(ItemOutcome::Cancelled),
        Err(error) => return Err(error),
    };

    if settings.skip_no_benefit && output.len() as u64 >= item.size {
        return Ok(ItemOutcome::NoBenefit {
            size: output.len() as u64,
            message: "压缩后文件不小于原文件".into(),
        });
    }
    if session.cancelled.load(Ordering::SeqCst) {
        return Ok(ItemOutcome::Cancelled);
    }

    let output_path = session.temp_root.join(format!("{}.compressed", item.id));
    atomic_write(&output_path, &output, session_id, &item.id, true)?;
    session
        .results
        .lock()
        .map_err(|_| "压缩结果状态不可用。".to_string())?
        .insert(
            item.id.clone(),
            CachedOutput {
                path: output_path,
                size: output.len() as u64,
            },
        );
    Ok(ItemOutcome::Succeeded {
        size: output.len() as u64,
        output_relative_path: relative_path_string(&item.relative_path),
    })
}

fn encode_lossy(
    input: &[u8],
    format: CompressionFormat,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, String> {
    ensure_not_cancelled(cancelled)?;
    let image = decode_oriented(input, format)?;
    match format {
        CompressionFormat::Png => encode_png_lossy(input, &image, cancelled),
        CompressionFormat::Jpeg => encode_jpeg_lossy(input, &image, cancelled),
        CompressionFormat::Webp => encode_webp_lossy(input, &image, cancelled),
    }
}

fn ensure_not_cancelled(cancelled: &AtomicBool) -> Result<(), String> {
    if cancelled.load(Ordering::SeqCst) {
        Err(CANCELLED_ERROR.into())
    } else {
        Ok(())
    }
}

fn encode_png_lossy(
    input: &[u8],
    image: &DynamicImage,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, String> {
    if contains_png_chunk(input, b"acTL") {
        return Err("暂不支持动画 PNG。".into());
    }
    let rgba = image.to_rgba8();
    let colors = rgba
        .pixels()
        .map(|pixel| {
            let [r, g, b, a] = pixel.0;
            if a == 0 {
                imagequant::RGBA::new(0, 0, 0, 0)
            } else {
                imagequant::RGBA::new(r, g, b, a)
            }
        })
        .collect::<Vec<_>>();
    let mut attributes = imagequant::new();
    attributes
        .set_speed(PNG_QUANTIZATION_SPEED)
        .map_err(|error| format!("PNG 量化参数无效：{error}"))?;
    attributes
        .set_quality(0, 100)
        .map_err(|error| format!("PNG 量化参数无效：{error}"))?;
    attributes
        .set_max_colors(PNG_MAX_COLORS)
        .map_err(|error| format!("PNG 量化参数无效：{error}"))?;
    let mut quantization_image = attributes
        .new_image_borrowed(&colors, rgba.width() as usize, rgba.height() as usize, 0.0)
        .map_err(|error| format!("PNG 量化输入无效：{error}"))?;
    let mut result = attributes
        .quantize(&mut quantization_image)
        .map_err(|error| format!("PNG 量化失败：{error}"))?;
    result
        .set_dithering_level(PNG_DITHERING)
        .map_err(|error| format!("PNG 抖动设置失败：{error}"))?;
    let (palette, indices) = result
        .remapped(&mut quantization_image)
        .map_err(|error| format!("PNG 调色板映射失败：{error}"))?;
    ensure_not_cancelled(cancelled)?;
    let indexed = encode_indexed_png(rgba.width(), rgba.height(), &palette, &indices)?;
    let indexed = restore_png_display_chunks(input, indexed)?;
    Ok(indexed)
}

fn encode_indexed_png(
    width: u32,
    height: u32,
    palette: &[imagequant::RGBA],
    indices: &[u8],
) -> Result<Vec<u8>, String> {
    let mut palette_rgb = Vec::with_capacity(palette.len() * 3);
    let mut alpha = Vec::with_capacity(palette.len());
    for color in palette {
        palette_rgb.extend_from_slice(&[color.r, color.g, color.b]);
        alpha.push(color.a);
    }
    while alpha.last() == Some(&255) {
        alpha.pop();
    }

    let mut output = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut output, width, height);
        encoder.set_color(png::ColorType::Indexed);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.set_palette(palette_rgb);
        if !alpha.is_empty() {
            encoder.set_trns(alpha);
        }
        encoder.set_compression(png::Compression::Balanced);
        let mut writer = encoder
            .write_header()
            .map_err(|error| format!("PNG 调色板写入失败：{error}"))?;
        writer
            .write_image_data(indices)
            .map_err(|error| format!("PNG 调色板写入失败：{error}"))?;
    }
    Ok(output)
}

fn restore_png_display_chunks(source: &[u8], encoded: Vec<u8>) -> Result<Vec<u8>, String> {
    const DISPLAY_CHUNKS: [[u8; 4]; 6] =
        [*b"cICP", *b"iCCP", *b"sRGB", *b"gAMA", *b"cHRM", *b"pHYs"];
    let source = img_parts::png::Png::from_bytes(Bytes::copy_from_slice(source))
        .map_err(|error| format!("PNG 色彩信息读取失败：{error}"))?;
    let preserved = source
        .chunks()
        .iter()
        .filter(|chunk| DISPLAY_CHUNKS.contains(&chunk.kind()))
        .cloned()
        .collect::<Vec<_>>();
    let mut output = img_parts::png::Png::from_bytes(Bytes::from(encoded))
        .map_err(|error| format!("PNG 色彩信息写入失败：{error}"))?;
    for kind in DISPLAY_CHUNKS {
        output.remove_chunks_by_type(kind);
    }
    for chunk in preserved.into_iter().rev() {
        output.chunks_mut().insert(1, chunk);
    }
    let mut bytes = Vec::with_capacity(output.len());
    output
        .encoder()
        .write_to(&mut bytes)
        .map_err(|error| format!("PNG 色彩信息写入失败：{error}"))?;
    Ok(bytes)
}

fn encode_jpeg_lossy(
    input: &[u8],
    image: &DynamicImage,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, String> {
    let icc = Jpeg::from_bytes(Bytes::copy_from_slice(input))
        .ok()
        .and_then(|jpeg| jpeg.icc_profile())
        .map(|profile| profile.to_vec());
    ensure_not_cancelled(cancelled)?;
    let output = encode_jpeg_candidate(image, LOSSY_QUALITY, icc.as_deref())?;
    ensure_not_cancelled(cancelled)?;
    Ok(output)
}

fn encode_jpeg_candidate(
    image: &DynamicImage,
    quality: u8,
    icc: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let mut encoder = JpegEncoder::new(JpegPreset::ProgressiveBalanced)
        .quality(quality)
        .progressive(true)
        .subsampling(Subsampling::S444);
    if let Some(icc) = icc {
        encoder = encoder.icc_profile(icc.to_vec());
    }
    if matches!(image.color(), image::ColorType::L8 | image::ColorType::La8) {
        let gray = image.to_luma8();
        encoder
            .encode_gray(gray.as_raw(), gray.width(), gray.height())
            .map_err(|error| format!("JPEG 编码失败：{error}"))
    } else {
        let rgb = image.to_rgb8();
        encoder
            .encode_rgb(rgb.as_raw(), rgb.width(), rgb.height())
            .map_err(|error| format!("JPEG 编码失败：{error}"))
    }
}

fn encode_webp_lossy(
    input: &[u8],
    image: &DynamicImage,
    cancelled: &AtomicBool,
) -> Result<Vec<u8>, String> {
    let source = WebP::from_bytes(Bytes::copy_from_slice(input))
        .map_err(|error| format!("WebP 文件无效：{error}"))?;
    if source.has_chunk(img_parts::webp::CHUNK_ANIM)
        || source.has_chunk(img_parts::webp::CHUNK_ANMF)
    {
        return Err("暂不支持动画 WebP。".into());
    }
    let icc = source.icc_profile().map(|profile| profile.to_vec());
    let mut rgba = image.to_rgba8();
    for pixel in rgba.pixels_mut() {
        if pixel.0[3] == 0 {
            pixel.0[0] = 0;
            pixel.0[1] = 0;
            pixel.0[2] = 0;
        }
    }
    ensure_not_cancelled(cancelled)?;
    let output = encode_webp_candidate(&rgba, LOSSY_QUALITY, icc.as_deref())?;
    ensure_not_cancelled(cancelled)?;
    Ok(output)
}

fn encode_webp_candidate(
    rgba: &image::RgbaImage,
    quality: u8,
    icc: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let has_alpha = rgba.pixels().any(|pixel| pixel.0[3] < 255);
    let mut config = webp::WebPConfig::new().map_err(|_| "无法初始化 WebP 编码器。".to_string())?;
    config.lossless = 0;
    config.quality = quality as f32;
    config.method = 4;
    config.alpha_quality = 100;
    config.alpha_compression = 1;
    config.exact = 0;
    config.use_sharp_yuv = 1;
    config.thread_level = 1;

    let encoded = if has_alpha {
        webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height())
            .encode_advanced(&config)
    } else {
        let rgb = DynamicImage::ImageRgba8(rgba.clone()).to_rgb8();
        webp::Encoder::from_rgb(rgb.as_raw(), rgb.width(), rgb.height()).encode_advanced(&config)
    }
    .map_err(|error| format!("WebP 编码失败：{error:?}"))?;

    let mut output = encoded.to_vec();
    if let Some(icc) = icc {
        let mut webp = WebP::from_bytes(Bytes::from(output))
            .map_err(|error| format!("WebP 色彩信息写入失败：{error}"))?;
        webp.set_icc_profile(Some(Bytes::copy_from_slice(icc)));
        if has_alpha {
            set_webp_alpha_flag(&mut webp)?;
        }
        webp.remove_chunks_by_id(img_parts::webp::CHUNK_EXIF);
        webp.remove_chunks_by_id(img_parts::webp::CHUNK_XMP);
        output = Vec::with_capacity(webp.len() as usize);
        webp.encoder()
            .write_to(&mut output)
            .map_err(|error| format!("WebP 色彩信息写入失败：{error}"))?;
    }
    Ok(output)
}

fn set_webp_alpha_flag(image: &mut WebP) -> Result<(), String> {
    let Some(index) = image
        .chunks()
        .iter()
        .position(|chunk| chunk.id() == img_parts::webp::CHUNK_VP8X)
    else {
        return Ok(());
    };
    let mut contents = image.chunks()[index]
        .content()
        .data()
        .ok_or_else(|| "WebP 扩展头无效。".to_string())?
        .to_vec();
    let flags = contents
        .first_mut()
        .ok_or_else(|| "WebP 扩展头无效。".to_string())?;
    *flags |= 0b0001_0000;
    image.chunks_mut()[index] = img_parts::riff::RiffChunk::new(
        img_parts::webp::CHUNK_VP8X,
        img_parts::riff::RiffContent::Data(Bytes::from(contents)),
    );
    Ok(())
}

fn decode_oriented(input: &[u8], format: CompressionFormat) -> Result<DynamicImage, String> {
    match format {
        CompressionFormat::Jpeg => decode_with_decoder(
            image::codecs::jpeg::JpegDecoder::new(Cursor::new(input))
                .map_err(|error| format!("JPEG 解码失败：{error}"))?,
        ),
        CompressionFormat::Webp => {
            let decoder = image::codecs::webp::WebPDecoder::new(Cursor::new(input))
                .map_err(|error| format!("WebP 解码失败：{error}"))?;
            if decoder.has_animation() {
                return Err("暂不支持动画 WebP。".into());
            }
            decode_with_decoder(decoder)
        }
        CompressionFormat::Png => decode_with_decoder(
            image::codecs::png::PngDecoder::new(Cursor::new(input))
                .map_err(|error| format!("PNG 解码失败：{error}"))?,
        ),
    }
}

fn decode_with_decoder<D: ImageDecoder>(mut decoder: D) -> Result<DynamicImage, String> {
    let (width, height) = decoder.dimensions();
    validate_dimensions(width, height)?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_PIXELS as u32);
    limits.max_image_height = Some(MAX_PIXELS as u32);
    limits.max_alloc = Some(MAX_DECODED_BYTES);
    decoder
        .set_limits(limits)
        .map_err(|error| format!("图片超过解码限制：{error}"))?;
    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|error| format!("图片解码失败：{error}"))?;
    image.apply_orientation(orientation);
    Ok(image)
}

fn create_thumbnail(item: &NativeSourceItem) -> Result<Vec<u8>, String> {
    let input = fs::read(&item.source_path).map_err(|error| format!("无法读取图片：{error}"))?;
    if input.len() as u64 > MAX_FILE_BYTES {
        return Err("文件超过 256 MiB 限制。".into());
    }
    let thumbnail =
        decode_oriented(&input, item.format)?.thumbnail(THUMBNAIL_MAX_EDGE, THUMBNAIL_MAX_EDGE);
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| format!("缩略图编码失败：{error}"))?;
    Ok(output.into_inner())
}

fn inspect_source(
    path: &Path,
    relative_path: &Path,
    item_id: String,
) -> Result<NativeSourceItem, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("无法读取文件信息：{error}"))?;
    if metadata.len() > MAX_FILE_BYTES {
        return Err("文件超过 256 MiB 限制。".into());
    }
    let format = format_from_extension(path).ok_or_else(|| "不支持的扩展名。".to_string())?;
    let header = read_header(path)?;
    if !magic_matches(format, &header) {
        return Err("文件内容与扩展名不匹配。".into());
    }
    let mut reader = ImageReader::open(path).map_err(|error| format!("无法打开图片：{error}"))?;
    reader.set_format(image_format(format));
    let (width, height) = reader
        .into_dimensions()
        .map_err(|error| format!("无法读取图片尺寸：{error}"))?;
    validate_dimensions(width, height)?;
    let bytes = fs::read(path).map_err(|error| format!("无法读取图片：{error}"))?;
    if format == CompressionFormat::Png && contains_png_chunk(&bytes, b"acTL") {
        return Err("暂不支持动画 PNG。".into());
    }
    if format == CompressionFormat::Webp {
        let webp = WebP::from_bytes(Bytes::from(bytes))
            .map_err(|error| format!("WebP 文件无效：{error}"))?;
        if webp.has_chunk(img_parts::webp::CHUNK_ANIM)
            || webp.has_chunk(img_parts::webp::CHUNK_ANMF)
        {
            return Err("暂不支持动画 WebP。".into());
        }
    }

    Ok(NativeSourceItem {
        id: item_id,
        source_path: path.to_path_buf(),
        relative_path: relative_path.to_path_buf(),
        format,
        width,
        height,
        size: metadata.len(),
    })
}

fn scan_folder(
    root: &Path,
    current: &Path,
    output: &mut Vec<(PathBuf, PathBuf)>,
    rejected: &mut usize,
) -> Result<(), String> {
    let entries = fs::read_dir(current).map_err(|error| format!("无法读取源文件夹：{error}"))?;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                *rejected += 1;
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => {
                *rejected += 1;
                continue;
            }
        };
        if file_type.is_symlink() {
            *rejected += 1;
            continue;
        }
        let path = entry.path();
        if file_type.is_dir() {
            if is_hidden_name(&entry.file_name()) {
                *rejected += 1;
                continue;
            }
            scan_folder(root, &path, output, rejected)?;
        } else if file_type.is_file() {
            if format_from_extension(&path).is_some() {
                if output.len() >= MAX_ITEMS {
                    *rejected += 1;
                    continue;
                }
                let canonical = match path.canonicalize() {
                    Ok(path) => path,
                    Err(_) => {
                        *rejected += 1;
                        continue;
                    }
                };
                let relative = canonical
                    .strip_prefix(root)
                    .map_err(|_| "检测到越过源文件夹的路径。".to_string())?
                    .to_path_buf();
                output.push((canonical, relative));
            } else {
                *rejected += 1;
            }
        }
    }
    Ok(())
}

fn validate_selected_file(path: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "文件不存在。".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("只支持普通图片文件。".into());
    }
    path.canonicalize()
        .map_err(|_| "无法读取文件路径。".to_string())
}

fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "文件夹不存在。".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("请选择普通文件夹。".into());
    }
    path.canonicalize()
        .map_err(|_| "无法读取文件夹路径。".to_string())
}

fn validate_output_root(session: &CompressionSession, path: &Path) -> Result<PathBuf, String> {
    let output = canonical_directory(path)?;
    if let Some(source_root) = &session.source_root {
        if output == *source_root || output.starts_with(source_root) {
            return Err("输出文件夹不能是源文件夹或其子文件夹。".into());
        }
    }
    if session.source_paths.contains(&output) {
        return Err("输出位置不能覆盖源文件。".into());
    }
    Ok(output)
}

fn validate_relative_path(path: &Path) -> Result<(), String> {
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err("输出相对路径无效。".into());
    }
    if path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("输出路径包含不安全的目录跳转。".into());
    }
    Ok(())
}

fn validate_output_ancestors(output_root: &Path, relative_path: &Path) -> Result<(), String> {
    let mut current = output_root.to_path_buf();
    let component_count = relative_path.components().count();
    for (index, component) in relative_path.components().enumerate() {
        if index + 1 == component_count {
            break;
        }
        let Component::Normal(component) = component else {
            return Err("输出路径包含不安全的目录跳转。".into());
        };
        current.push(component);
        if current.exists() {
            let metadata = fs::symlink_metadata(&current)
                .map_err(|error| format!("无法检查输出目录：{error}"))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("输出路径包含不安全的目录链接。".into());
            }
            let canonical = current
                .canonicalize()
                .map_err(|error| format!("无法检查输出目录：{error}"))?;
            if !canonical.starts_with(output_root) {
                return Err("输出路径越过了所选输出文件夹。".into());
            }
        }
    }
    Ok(())
}

fn reject_source_output_conflict(
    session: &CompressionSession,
    output: &Path,
) -> Result<(), String> {
    if output.exists() {
        if let Ok(canonical) = output.canonicalize() {
            if session.source_paths.contains(&canonical) {
                return Err("输出文件不能覆盖任一源文件。".into());
            }
        }
    }
    Ok(())
}

fn resolve_output_path(
    requested: &Path,
    policy: CompressionConflictPolicy,
) -> Result<Option<PathBuf>, String> {
    if !requested.exists() {
        return Ok(Some(requested.to_path_buf()));
    }
    match policy {
        CompressionConflictPolicy::Skip => Ok(None),
        CompressionConflictPolicy::Overwrite => Ok(Some(requested.to_path_buf())),
        CompressionConflictPolicy::Rename => {
            let parent = requested
                .parent()
                .ok_or_else(|| "输出路径无效。".to_string())?;
            let stem = requested
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("image");
            let extension = requested
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            for index in 1..=10_000 {
                let file_name = if extension.is_empty() {
                    format!("{stem} ({index})")
                } else {
                    format!("{stem} ({index}).{extension}")
                };
                let candidate = parent.join(file_name);
                if !candidate.exists() {
                    return Ok(Some(candidate));
                }
            }
            Err("无法为同名文件生成可用名称。".into())
        }
    }
}

fn resolve_safe_output_path(
    session: &CompressionSession,
    requested: &Path,
    policy: CompressionConflictPolicy,
) -> Result<Option<PathBuf>, String> {
    let resolved = resolve_output_path(requested, policy)?;
    if let Some(output) = resolved.as_deref() {
        reject_source_output_conflict(session, output)?;
    }
    Ok(resolved)
}

fn atomic_write(
    output_path: &Path,
    bytes: &[u8],
    session_id: &str,
    item_id: &str,
    overwrite: bool,
) -> Result<(), String> {
    let parent = output_path
        .parent()
        .ok_or_else(|| "输出路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建输出目录：{error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_name = format!(".huanhua-{session_id}-{item_id}-{nonce}.tmp");
    let temp_path = parent.join(temp_name);
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp_path)
        .map_err(|error| format!("无法创建临时文件：{error}"))?;
    let write_result = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("无法写入输出文件：{error}"));
    }
    let commit_result = if overwrite {
        atomic_replace(&temp_path, output_path)
    } else {
        fs::hard_link(&temp_path, output_path).and_then(|_| fs::remove_file(&temp_path))
    };
    commit_result.map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("无法完成输出文件写入：{error}")
    })
}

fn atomic_copy(
    source_path: &Path,
    output_path: &Path,
    session_id: &str,
    item_id: &str,
    overwrite: bool,
) -> Result<(), String> {
    let parent = output_path
        .parent()
        .ok_or_else(|| "输出路径无效。".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("无法创建输出目录：{error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = parent.join(format!(".huanhua-{session_id}-{item_id}-{nonce}.tmp"));
    fs::copy(source_path, &temp_path).map_err(|error| format!("无法复制压缩结果：{error}"))?;
    let sync_result = fs::File::open(&temp_path).and_then(|file| file.sync_all());
    if let Err(error) = sync_result {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("无法同步输出文件：{error}"));
    }
    let commit_result = if overwrite {
        atomic_replace(&temp_path, output_path)
    } else {
        fs::hard_link(&temp_path, output_path).and_then(|_| fs::remove_file(&temp_path))
    };
    commit_result.map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("无法完成输出文件写入：{error}")
    })
}

#[cfg(unix)]
fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(windows)]
fn atomic_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("图片尺寸超过 64 MP 限制。".into());
    }
    Ok(())
}

fn format_from_extension(path: &Path) -> Option<CompressionFormat> {
    match path
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some(CompressionFormat::Png),
        "jpg" | "jpeg" => Some(CompressionFormat::Jpeg),
        "webp" => Some(CompressionFormat::Webp),
        _ => None,
    }
}

fn image_format(format: CompressionFormat) -> ImageFormat {
    match format {
        CompressionFormat::Png => ImageFormat::Png,
        CompressionFormat::Jpeg => ImageFormat::Jpeg,
        CompressionFormat::Webp => ImageFormat::WebP,
    }
}

fn read_header(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut file = fs::File::open(path).map_err(|error| format!("无法打开图片：{error}"))?;
    let mut buffer = vec![0; 16];
    let read = file
        .read(&mut buffer)
        .map_err(|error| format!("无法读取图片：{error}"))?;
    buffer.truncate(read);
    Ok(buffer)
}

fn magic_matches(format: CompressionFormat, bytes: &[u8]) -> bool {
    match format {
        CompressionFormat::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        CompressionFormat::Jpeg => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        CompressionFormat::Webp => {
            bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
        }
    }
}

fn contains_png_chunk(bytes: &[u8], expected: &[u8; 4]) -> bool {
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return false;
    }
    let mut offset = 8usize;
    while offset.checked_add(12).is_some_and(|end| end <= bytes.len()) {
        let length = u32::from_be_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        if &bytes[offset + 4..offset + 8] == expected {
            return true;
        }
        let Some(next) = offset
            .checked_add(12)
            .and_then(|value| value.checked_add(length))
        else {
            return false;
        };
        if next > bytes.len() {
            return false;
        }
        offset = next;
    }
    false
}

fn file_name_path(path: &Path) -> PathBuf {
    path.file_name()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("image"))
}

fn is_hidden_name(name: &std::ffi::OsStr) -> bool {
    name.to_string_lossy().starts_with('.')
}

fn relative_path_string(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn new_session_id(state: &CompressionState) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let sequence = state.sequence.fetch_add(1, Ordering::Relaxed);
    format!("compress-{timestamp}-{sequence}")
}

fn create_session_temp_root(session_id: &str) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("huanhua-{session_id}"));
    fs::create_dir(&path).map_err(|error| format!("无法创建压缩临时目录：{error}"))?;
    Ok(path)
}

fn saved_percent(original: u64, output: u64) -> Option<f64> {
    if original == 0 {
        None
    } else {
        Some((original as f64 - output as f64) / original as f64 * 100.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{GenericImageView, ImageBuffer, Rgba};
    use img_parts::ImageEXIF;

    fn sample_rgba() -> DynamicImage {
        DynamicImage::ImageRgba8(ImageBuffer::from_fn(32, 24, |x, y| {
            Rgba([(x * 7) as u8, (y * 9) as u8, 120, ((x + y) * 4) as u8])
        }))
    }

    fn sample_webp_rgba() -> DynamicImage {
        DynamicImage::ImageRgba8(ImageBuffer::from_fn(192, 128, |x, y| {
            if !(16..176).contains(&x) || !(16..112).contains(&y) {
                Rgba([180, 90, 30, 0])
            } else if x < 96 {
                Rgba([36, 112, 184, 255])
            } else {
                Rgba([224, 168, 48, 255])
            }
        }))
    }

    fn noisy_rgb(width: u32, height: u32) -> Vec<u8> {
        (0..width * height)
            .flat_map(|index| {
                let value = index.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                [value as u8, (value >> 9) as u8, (value >> 17) as u8]
            })
            .collect()
    }

    fn settings() -> CompressionSettings {
        CompressionSettings {
            conflict_policy: CompressionConflictPolicy::Skip,
            skip_no_benefit: true,
        }
    }

    fn png_bytes(image: &DynamicImage) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, ImageFormat::Png).unwrap();
        output.into_inner()
    }

    fn test_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("huanhua-compression-{label}-{nonce}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn test_session(
        label: &str,
        source_root: Option<PathBuf>,
        items: Vec<NativeSourceItem>,
        source_paths: HashSet<PathBuf>,
    ) -> CompressionSession {
        CompressionSession {
            source_root,
            items,
            source_paths,
            temp_root: test_directory(&format!("{label}-cache")),
            results: Mutex::new(HashMap::new()),
            work_lock: Mutex::new(()),
            cancelled: AtomicBool::new(false),
            running: AtomicBool::new(false),
        }
    }

    #[test]
    fn progress_event_fields_use_frontend_camel_case_contract() {
        let event = CompressionProgressEvent::ItemStarted {
            item_id: "item-1".into(),
            index: 0,
            total: 1,
            relative_path: "nested/image.png".into(),
        };
        let value = serde_json::to_value(event).unwrap();

        assert_eq!(value["type"], "itemStarted");
        assert_eq!(value["itemId"], "item-1");
        assert_eq!(value["relativePath"], "nested/image.png");
        assert!(value.get("item_id").is_none());

        let finished = CompressionProgressEvent::ItemFinished {
            item_id: "item-1".into(),
            index: 0,
            status: "succeeded".into(),
            output_relative_path: Some("nested/image (1).png".into()),
            output_size: Some(512),
            saved_percent: Some(48.8),
            message: None,
        };
        let finished = serde_json::to_value(finished).unwrap();
        assert_eq!(finished["outputRelativePath"], "nested/image (1).png");
        assert!(finished.get("output_relative_path").is_none());
    }

    #[test]
    fn save_command_is_allowed_by_the_desktop_capability() {
        let permissions = include_str!("../permissions/compression.toml");
        assert!(permissions.contains("\"compression_save\""));
    }

    #[test]
    fn jpeg_and_webp_outputs_are_decodable() {
        let image = sample_rgba();
        let mut jpeg_input = Vec::new();
        image
            .to_rgb8()
            .write_with_encoder(image::codecs::jpeg::JpegEncoder::new_with_quality(
                &mut jpeg_input,
                90,
            ))
            .unwrap();
        let cancelled = AtomicBool::new(false);
        let jpeg = encode_lossy(&jpeg_input, CompressionFormat::Jpeg, &cancelled).unwrap();
        assert!(image::load_from_memory_with_format(&jpeg, ImageFormat::Jpeg).is_ok());

        let rgba = sample_webp_rgba().to_rgba8();
        let webp_input = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height())
            .encode_lossless()
            .to_vec();
        let webp = encode_lossy(&webp_input, CompressionFormat::Webp, &cancelled).unwrap();
        assert!(image::load_from_memory_with_format(&webp, ImageFormat::WebP).is_ok());
    }

    #[test]
    fn relative_paths_reject_escape_components() {
        assert!(validate_relative_path(Path::new("a/b.png")).is_ok());
        assert!(validate_relative_path(Path::new("../b.png")).is_err());
        assert!(validate_relative_path(Path::new("/b.png")).is_err());
    }

    #[test]
    fn magic_detection_requires_expected_container() {
        assert!(magic_matches(
            CompressionFormat::Png,
            b"\x89PNG\r\n\x1a\nrest"
        ));
        assert!(!magic_matches(
            CompressionFormat::Jpeg,
            b"\x89PNG\r\n\x1a\nrest"
        ));
        assert!(magic_matches(CompressionFormat::Webp, b"RIFF\0\0\0\0WEBP"));
    }

    #[test]
    fn png_lossy_compression_preserves_dimensions_and_strips_text() {
        let original = sample_rgba();
        let mut png = img_parts::png::Png::from_bytes(Bytes::from(png_bytes(&original))).unwrap();
        let text = img_parts::png::PngChunk::new(*b"tEXt", Bytes::from_static(b"author\0private"));
        let insert_at = png.chunks().len() - 1;
        png.chunks_mut().insert(insert_at, text);
        let mut input = Vec::new();
        png.encoder().write_to(&mut input).unwrap();

        let cancelled = AtomicBool::new(false);
        let output = encode_lossy(&input, CompressionFormat::Png, &cancelled).unwrap();
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::Png).unwrap();
        assert_eq!(decoded.dimensions(), original.dimensions());
        assert!(output.starts_with(b"\x89PNG\r\n\x1a\n"));
        let parsed = img_parts::png::Png::from_bytes(Bytes::from(output)).unwrap();
        assert!(parsed.chunk_by_type(*b"tEXt").is_none());
    }

    #[test]
    fn png_lossy_compression_uses_an_indexed_palette() {
        let original = DynamicImage::ImageRgba8(ImageBuffer::from_fn(384, 256, |x, y| {
            let index = y * 384 + x;
            let mut hash = index;
            hash ^= hash >> 16;
            hash = hash.wrapping_mul(0x7feb_352d);
            hash ^= hash >> 15;
            hash = hash.wrapping_mul(0x846c_a68b);
            hash ^= hash >> 16;
            let value = (hash % 200) as u8;
            Rgba([value, value.wrapping_mul(3), value.wrapping_mul(7), 255])
        }));
        let input = png_bytes(&original);
        let output = encode_lossy(&input, CompressionFormat::Png, &AtomicBool::new(false)).unwrap();

        assert!(output.len() < input.len());
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::Png).unwrap();
        assert_eq!(decoded.dimensions(), original.dimensions());
        let parsed = img_parts::png::Png::from_bytes(Bytes::from(output)).unwrap();
        let ihdr = parsed.chunk_by_type(*b"IHDR").unwrap();
        assert_eq!(ihdr.contents()[9], 3);
    }

    #[test]
    #[ignore = "repository benchmark fixture"]
    fn repository_png_fixture_uses_fast_lossy_compression() {
        use std::time::Instant;

        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/test.png");
        let input = fs::read(path).unwrap();
        let reference = decode_oriented(&input, CompressionFormat::Png).unwrap();
        let started = Instant::now();
        let output = encode_lossy(&input, CompressionFormat::Png, &AtomicBool::new(false)).unwrap();
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::Png).unwrap();

        assert!(output.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert_eq!(decoded.dimensions(), reference.dimensions());
        assert!(output.len() < input.len());
        eprintln!(
            "{} -> {} bytes in {:?}",
            input.len(),
            output.len(),
            started.elapsed()
        );
    }

    #[test]
    #[ignore = "set HUANHUA_COMPRESSION_FIXTURE to benchmark an external PNG"]
    fn external_png_fixture_uses_production_lossy_compression() {
        use std::time::Instant;

        let path = std::env::var_os("HUANHUA_COMPRESSION_FIXTURE")
            .map(PathBuf::from)
            .expect("HUANHUA_COMPRESSION_FIXTURE is required");
        let input = fs::read(&path).unwrap();
        let reference = decode_oriented(&input, CompressionFormat::Png).unwrap();
        let started = Instant::now();
        let output = encode_lossy(&input, CompressionFormat::Png, &AtomicBool::new(false)).unwrap();
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::Png).unwrap();

        assert!(output.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert_eq!(decoded.dimensions(), reference.dimensions());
        assert!(output.len() < input.len());
        eprintln!(
            "{}: {} -> {} bytes ({:.1}% smaller) in {:?}",
            path.display(),
            input.len(),
            output.len(),
            (1.0 - output.len() as f64 / input.len() as f64) * 100.0,
            started.elapsed()
        );
    }

    #[test]
    fn thumbnail_is_bounded_decodable_and_preserves_alpha() {
        let root = test_directory("thumbnail");
        let source_path = root.join("wide.png");
        let original = DynamicImage::ImageRgba8(ImageBuffer::from_fn(640, 240, |x, y| {
            Rgba([x as u8, y as u8, 120, if x < 320 { 0 } else { 255 }])
        }));
        let input = png_bytes(&original);
        fs::write(&source_path, &input).unwrap();
        let item = NativeSourceItem {
            id: "thumbnail-item".into(),
            source_path,
            relative_path: PathBuf::from("wide.png"),
            format: CompressionFormat::Png,
            width: 640,
            height: 240,
            size: input.len() as u64,
        };

        let bytes = create_thumbnail(&item).unwrap();
        let decoded = image::load_from_memory_with_format(&bytes, ImageFormat::Png).unwrap();
        assert_eq!(decoded.dimensions(), (320, 120));
        let alpha = decoded.to_rgba8();
        assert!(alpha.get_pixel(20, 60).0[3] < 255);
        assert_eq!(alpha.get_pixel(300, 60).0[3], 255);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_apng_and_animated_webp() {
        let mut png =
            img_parts::png::Png::from_bytes(Bytes::from(png_bytes(&sample_rgba()))).unwrap();
        png.chunks_mut().insert(
            1,
            img_parts::png::PngChunk::new(*b"acTL", Bytes::from_static(&[0; 8])),
        );
        let mut apng = Vec::new();
        png.encoder().write_to(&mut apng).unwrap();
        let cancelled = AtomicBool::new(false);
        assert!(encode_lossy(&apng, CompressionFormat::Png, &cancelled).is_err());

        let rgba = sample_rgba().to_rgba8();
        let still = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height())
            .encode_lossless()
            .to_vec();
        let mut animated = WebP::from_bytes(Bytes::from(still)).unwrap();
        animated.chunks_mut().push(img_parts::riff::RiffChunk::new(
            img_parts::webp::CHUNK_ANIM,
            img_parts::riff::RiffContent::Data(Bytes::from_static(&[0; 6])),
        ));
        let mut bytes = Vec::new();
        animated.encoder().write_to(&mut bytes).unwrap();
        assert!(encode_lossy(&bytes, CompressionFormat::Webp, &cancelled).is_err());
    }

    #[test]
    fn jpeg_applies_orientation_preserves_icc_and_removes_exif() {
        let pixels = vec![255, 0, 0, 0, 255, 0];
        let exif_orientation_6 = vec![
            b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0,
            0,
        ];
        let icc = b"test-icc-profile".to_vec();
        let input = JpegEncoder::new(JpegPreset::BaselineBalanced)
            .quality(95)
            .exif_data(exif_orientation_6)
            .icc_profile(icc.clone())
            .encode_rgb(&pixels, 2, 1)
            .unwrap();
        let image = decode_oriented(&input, CompressionFormat::Jpeg).unwrap();
        let output = encode_jpeg_candidate(&image, LOSSY_QUALITY, Some(&icc)).unwrap();
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::Jpeg).unwrap();
        assert_eq!(decoded.dimensions(), (1, 2));
        let parsed = Jpeg::from_bytes(Bytes::from(output)).unwrap();
        assert_eq!(parsed.icc_profile().unwrap().as_ref(), icc.as_slice());
        assert!(parsed.exif().is_none());
    }

    #[test]
    fn jpeg_and_webp_quality_candidates_affect_size() {
        let pixels = noisy_rgb(128, 128);
        let input_jpeg = JpegEncoder::new(JpegPreset::BaselineBalanced)
            .quality(95)
            .encode_rgb(&pixels, 128, 128)
            .unwrap();
        let decoded_jpeg = decode_oriented(&input_jpeg, CompressionFormat::Jpeg).unwrap();
        let low_jpeg = encode_jpeg_candidate(&decoded_jpeg, 20, None).unwrap();
        let high_jpeg = encode_jpeg_candidate(&decoded_jpeg, 95, None).unwrap();
        assert!(low_jpeg.len() < high_jpeg.len());

        let input_webp = webp::Encoder::from_rgb(&pixels, 128, 128)
            .encode_lossless()
            .to_vec();
        let decoded_webp = decode_oriented(&input_webp, CompressionFormat::Webp).unwrap();
        let rgba = decoded_webp.to_rgba8();
        let low_webp = encode_webp_candidate(&rgba, 20, None).unwrap();
        let high_webp = encode_webp_candidate(&rgba, 95, None).unwrap();
        assert!(low_webp.len() < high_webp.len());
    }

    #[test]
    fn webp_lossy_compression_preserves_dimensions_alpha_and_icc() {
        let original = sample_webp_rgba();
        let rgba = original.to_rgba8();
        let still = webp::Encoder::from_rgba(rgba.as_raw(), rgba.width(), rgba.height())
            .encode_lossless()
            .to_vec();
        let icc = Bytes::from_static(b"webp-icc-profile");
        let mut source = WebP::from_bytes(Bytes::from(still)).unwrap();
        source.set_icc_profile(Some(icc.clone()));
        source.set_exif(Some(Bytes::from_static(b"II*\0private")));
        source.chunks_mut().push(img_parts::riff::RiffChunk::new(
            img_parts::webp::CHUNK_XMP,
            img_parts::riff::RiffContent::Data(Bytes::from_static(b"private xmp")),
        ));
        set_webp_alpha_flag(&mut source).unwrap();
        let mut input = Vec::new();
        source.encoder().write_to(&mut input).unwrap();
        let cancelled = AtomicBool::new(false);
        let output = encode_lossy(&input, CompressionFormat::Webp, &cancelled).unwrap();
        let decoded = image::load_from_memory_with_format(&output, ImageFormat::WebP)
            .unwrap()
            .to_rgba8();
        assert_eq!(decoded.dimensions(), rgba.dimensions());
        assert_eq!(decoded.get_pixel(0, 0).0[3], 0);
        assert_eq!(decoded.get_pixel(96, 64).0[3], 255);
        let parsed = WebP::from_bytes(Bytes::from(output)).unwrap();
        assert_eq!(parsed.icc_profile(), Some(icc));
        assert!(parsed.exif().is_none());
        assert!(!parsed.has_chunk(img_parts::webp::CHUNK_XMP));
    }

    #[test]
    fn output_policy_and_atomic_write_are_deterministic() {
        let root = test_directory("write");
        let output = root.join("nested").join("image.png");
        atomic_write(&output, b"first", "session", "item", false).unwrap();
        assert_eq!(fs::read(&output).unwrap(), b"first");
        assert!(
            resolve_output_path(&output, CompressionConflictPolicy::Skip)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            resolve_output_path(&output, CompressionConflictPolicy::Overwrite).unwrap(),
            Some(output.clone())
        );
        let renamed = resolve_output_path(&output, CompressionConflictPolicy::Rename)
            .unwrap()
            .unwrap();
        assert_eq!(renamed.file_name().unwrap(), "image (1).png");
        atomic_write(&output, b"second", "session", "item", true).unwrap();
        assert_eq!(fs::read(&output).unwrap(), b"second");
        assert!(!fs::read_dir(output.parent().unwrap())
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn automatic_rename_allows_source_directory_as_output() {
        let root = test_directory("source-output-rename");
        let source = root.join("image.png");
        fs::write(&source, b"source").unwrap();
        let canonical_source = source.canonicalize().unwrap();
        let session = test_session(
            "source-output-rename",
            None,
            Vec::new(),
            HashSet::from([canonical_source]),
        );

        let renamed =
            resolve_safe_output_path(&session, &source, CompressionConflictPolicy::Rename)
                .unwrap()
                .unwrap();
        assert_eq!(renamed.file_name().unwrap(), "image (1).png");
        assert!(
            resolve_safe_output_path(&session, &source, CompressionConflictPolicy::Overwrite,)
                .is_err()
        );
        assert!(
            resolve_safe_output_path(&session, &source, CompressionConflictPolicy::Skip)
                .unwrap()
                .is_none()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn process_item_caches_then_save_renames_without_overwriting_source() {
        let root = test_directory("process-source-output-rename");
        let source = root.join("image.png");
        let input = png_bytes(&sample_rgba());
        fs::write(&source, &input).unwrap();
        let canonical_source = source.canonicalize().unwrap();
        let item = NativeSourceItem {
            id: "item-1".into(),
            source_path: canonical_source.clone(),
            relative_path: PathBuf::from("image.png"),
            format: CompressionFormat::Png,
            width: 32,
            height: 24,
            size: input.len() as u64,
        };
        let session = test_session(
            "process-source-output-rename",
            None,
            vec![item.clone()],
            HashSet::from([canonical_source]),
        );
        let mut config = settings();
        config.conflict_policy = CompressionConflictPolicy::Rename;
        config.skip_no_benefit = false;

        let outcome = process_item("session", &session, &item, &config).unwrap();
        let ItemOutcome::Succeeded {
            output_relative_path,
            ..
        } = outcome
        else {
            panic!("expected cached output");
        };
        assert_eq!(output_relative_path, "image.png");
        assert_eq!(fs::read(&source).unwrap(), input);
        assert!(!root.join("image (1).png").exists());

        let summary = save_session(
            "session",
            &session,
            &HashSet::from([item.id.clone()]),
            &root,
            CompressionConflictPolicy::Rename,
        )
        .unwrap();
        assert_eq!(summary.saved, 1);
        assert_eq!(
            summary.items[0].output_relative_path.as_deref(),
            Some("image (1).png")
        );
        assert!(root.join("image (1).png").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_output_inside_folder_source() {
        let root = test_directory("root-safety");
        let output = root.join("output");
        fs::create_dir_all(&output).unwrap();
        let session = test_session(
            "root-safety",
            Some(root.canonicalize().unwrap()),
            Vec::new(),
            HashSet::new(),
        );
        assert!(validate_output_root(&session, &root).is_err());
        assert!(validate_output_root(&session, &output).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_output_ancestor() {
        use std::os::unix::fs::symlink;
        let root = test_directory("symlink-root");
        let outside = test_directory("symlink-outside");
        symlink(&outside, root.join("linked")).unwrap();
        assert!(validate_output_ancestors(&root, Path::new("linked/image.png")).is_err());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn uppercase_extensions_are_supported() {
        assert_eq!(
            format_from_extension(Path::new("A.PNG")),
            Some(CompressionFormat::Png)
        );
        assert_eq!(
            format_from_extension(Path::new("B.JPEG")),
            Some(CompressionFormat::Jpeg)
        );
        assert_eq!(
            format_from_extension(Path::new("C.WEBP")),
            Some(CompressionFormat::Webp)
        );
    }

    #[test]
    fn cancelled_batch_does_not_start_an_item() {
        let session = test_session(
            "cancelled",
            None,
            vec![NativeSourceItem {
                id: "item".into(),
                source_path: PathBuf::from("missing.png"),
                relative_path: PathBuf::from("missing.png"),
                format: CompressionFormat::Png,
                width: 1,
                height: 1,
                size: 1,
            }],
            HashSet::new(),
        );
        session.cancelled.store(true, Ordering::SeqCst);
        let channel = Channel::new(|_| Ok(()));
        let summary = run_session(
            "session",
            &session,
            &HashSet::from(["item".to_string()]),
            &settings(),
            &channel,
        )
        .unwrap();
        assert_eq!(summary.cancelled, 1);
        assert!(summary.was_cancelled);
        assert_eq!(summary.failed, 0);
    }

    #[test]
    fn folder_scan_preserves_nested_relative_paths_and_skips_hidden_directories() {
        let root = test_directory("scan");
        let nested = root.join("a").join("b");
        let hidden = root.join(".hidden");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir_all(&hidden).unwrap();
        let png = png_bytes(&sample_rgba());
        fs::write(nested.join("IMAGE.PNG"), &png).unwrap();
        fs::write(hidden.join("ignored.png"), &png).unwrap();
        fs::write(root.join("notes.txt"), b"not an image").unwrap();
        let canonical = root.canonicalize().unwrap();
        let mut candidates = Vec::new();
        let mut rejected = 0;
        scan_folder(&canonical, &canonical, &mut candidates, &mut rejected).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(relative_path_string(&candidates[0].1), "a/b/IMAGE.PNG");
        assert_eq!(rejected, 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn no_benefit_candidate_is_not_written() {
        let source_root = test_directory("no-benefit-source");
        let source_path = source_root.join("image.png");
        fs::write(&source_path, png_bytes(&sample_rgba())).unwrap();
        let source_path = source_path.canonicalize().unwrap();
        let mut item = inspect_source(&source_path, Path::new("image.png"), "item".into()).unwrap();
        item.size = 0;
        let session = test_session("no-benefit", None, vec![item], HashSet::from([source_path]));
        let outcome = process_item("session", &session, &session.items[0], &settings()).unwrap();
        assert!(matches!(outcome, ItemOutcome::NoBenefit { .. }));
        assert!(session.results.lock().unwrap().is_empty());
        fs::remove_dir_all(source_root).unwrap();
    }

    #[test]
    fn batch_continues_after_an_item_failure() {
        let source_root = test_directory("partial-source");
        let source_path = source_root.join("ok.png");
        fs::write(&source_path, png_bytes(&sample_rgba())).unwrap();
        let source_path = source_path.canonicalize().unwrap();
        let valid =
            inspect_source(&source_path, Path::new("nested/ok.png"), "valid".into()).unwrap();
        let invalid = NativeSourceItem {
            id: "invalid".into(),
            source_path: source_root.join("missing.png"),
            relative_path: PathBuf::from("nested/missing.png"),
            format: CompressionFormat::Png,
            width: 1,
            height: 1,
            size: 1,
        };
        let session = test_session(
            "partial",
            None,
            vec![invalid, valid],
            HashSet::from([source_path]),
        );
        let mut config = settings();
        config.skip_no_benefit = false;
        let channel = Channel::new(|_| Ok(()));
        let summary = run_session(
            "session",
            &session,
            &HashSet::from(["invalid".to_string(), "valid".to_string()]),
            &config,
            &channel,
        )
        .unwrap();
        assert_eq!(summary.failed, 1);
        assert_eq!(summary.succeeded, 1);
        assert!(session.results.lock().unwrap().contains_key("valid"));
        fs::remove_dir_all(source_root).unwrap();
    }
}
