use std::{
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    sync::Mutex,
};

use image::{imageops::FilterType, DynamicImage, ImageFormat};
use ort::{
    session::{builder::GraphOptimizationLevel, Session},
    value::Tensor,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, State,
};

const DET_FILE: &str = "auto-layer-ocr-det.onnx";
const DET_SIZE: u64 = 4_826_518;
const DET_SHA256: &str = "a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d";
const REC_FILE: &str = "auto-layer-ocr-rec.onnx";
const REC_SIZE: u64 = 16_534_782;
const REC_SHA256: &str = "da72dc72ca4dc220df0dfde68c1dedc31c58d3e76a25871122e5056227d50092";
const DICTIONARY_FILE: &str = "auto-layer-ocr-inference.yml";
const INPUT_HEIGHT: u32 = 48;
const INPUT_WIDTH: u32 = 320;
const DET_MAX_SIDE: u32 = 960;
const DET_THRESHOLD: f32 = 0.3;
const SIGLIP_FILE: &str = "auto-layer-siglip2-vision-int8.onnx";
const SIGLIP_SIZE: u64 = 94_553_333;
const SIGLIP_SHA256: &str = "5f2b401c1a4fc095702a5d45348e17ad46c4f87064085365b43c6e8eaa5c0070";
const SIGLIP_SIZE_PX: u32 = 224;
const SELECTION_SOURCE_MAX_BYTES: u64 = 256 * 1024 * 1024;
const SIGLIP_LABELS: [&str; 12] = [
    "card",
    "btn",
    "icon",
    "avatar",
    "image",
    "nav",
    "tab",
    "panel",
    "badge",
    "character",
    "decoration",
    "element",
];

#[derive(Default)]
pub struct AutoLayerState {
    ocr: Mutex<Option<LoadedOcr>>,
    classifier: Mutex<Option<LoadedClassifier>>,
}

struct LoadedOcr {
    detector: Session,
    recognizer: Session,
    characters: Vec<String>,
}

struct LoadedClassifier {
    session: Session,
    label_vectors: Vec<Vec<f32>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrLine {
    text: String,
    confidence: f32,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
struct Classification {
    #[serde(rename = "type")]
    kind: &'static str,
    confidence: f32,
}

fn model_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("models").join(file_name))
        .map_err(|error| format!("无法定位自动分层模型目录：{error}"))
}

fn validate_file(
    path: &Path,
    expected_size: u64,
    expected_sha256: &str,
    label: &str,
) -> Result<(), String> {
    let metadata = path.metadata().map_err(|_| format!("{label}未安装。"))?;
    if metadata.len() != expected_size {
        return Err(format!("{label}大小校验失败，请重新安装识别资源。"));
    }
    let mut reader =
        BufReader::new(File::open(path).map_err(|error| format!("无法读取{label}：{error}"))?);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取{label}失败：{error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    if format!("{:x}", hasher.finalize()) != expected_sha256 {
        return Err(format!("{label} SHA-256 校验失败，请重新安装识别资源。"));
    }
    Ok(())
}

fn parse_characters(path: &Path) -> Result<Vec<String>, String> {
    let value: serde_yaml::Value =
        serde_yaml::from_reader(File::open(path).map_err(|_| "OCR 字符表未安装。".to_string())?)
            .map_err(|error| format!("OCR 字符表格式无效：{error}"))?;
    let dictionary = value
        .get("PostProcess")
        .and_then(|value| value.get("character_dict"))
        .and_then(|value| value.as_sequence())
        .ok_or_else(|| "OCR 字符表缺少 character_dict。".to_string())?;
    let mut characters = Vec::with_capacity(dictionary.len() + 1);
    characters.push(String::new());
    for character in dictionary {
        characters.push(character.as_str().unwrap_or_default().to_string());
    }
    characters.push(" ".to_string());
    Ok(characters)
}

fn create_session(path: &Path, label: &str) -> Result<Session, String> {
    Session::builder()
        .and_then(|builder| {
            builder
                .with_optimization_level(GraphOptimizationLevel::Level3)?
                .with_intra_threads(
                    std::thread::available_parallelism()
                        .map(|value| value.get().min(4))
                        .unwrap_or(1),
                )?
                .with_inter_threads(1)?
                .with_parallel_execution(false)?
                .commit_from_file(path)
        })
        .map_err(|error| format!("加载{label}失败：{error}"))
}

fn raw_body(request: Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) if !bytes.is_empty() => Ok(bytes.clone()),
        _ => Err("OCR 输入图片为空。".to_string()),
    }
}

fn decode_base64(source: &[u8]) -> Result<Vec<u8>, String> {
    fn value(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let filtered = source
        .iter()
        .copied()
        .filter(|byte| !byte.is_ascii_whitespace())
        .collect::<Vec<_>>();
    if filtered.len() % 4 != 0 {
        return Err("SigLIP 标签向量格式无效。".to_string());
    }
    let mut output = Vec::with_capacity(filtered.len() / 4 * 3);
    for chunk in filtered.chunks_exact(4) {
        let a = value(chunk[0]).ok_or_else(|| "SigLIP 标签向量包含无效字符。".to_string())? as u32;
        let b = value(chunk[1]).ok_or_else(|| "SigLIP 标签向量包含无效字符。".to_string())? as u32;
        let c = if chunk[2] == b'=' {
            0
        } else {
            value(chunk[2]).ok_or_else(|| "SigLIP 标签向量包含无效字符。".to_string())? as u32
        };
        let d = if chunk[3] == b'=' {
            0
        } else {
            value(chunk[3]).ok_or_else(|| "SigLIP 标签向量包含无效字符。".to_string())? as u32
        };
        let bits = a << 18 | b << 12 | c << 6 | d;
        output.push((bits >> 16) as u8);
        if chunk[2] != b'=' {
            output.push((bits >> 8) as u8);
        }
        if chunk[3] != b'=' {
            output.push(bits as u8);
        }
    }
    Ok(output)
}

fn load_label_vectors() -> Result<Vec<Vec<f32>>, String> {
    let bytes = decode_base64(include_bytes!("auto_layer_labels.b64"))?;
    if bytes.len() % (SIGLIP_LABELS.len() * 2) != 0 {
        return Err("SigLIP 标签向量长度无效。".to_string());
    }
    let dimensions = bytes.len() / SIGLIP_LABELS.len() / 2;
    if dimensions != 768 {
        return Err(format!("SigLIP 标签向量维度无效：{dimensions}"));
    }
    Ok(bytes
        .chunks_exact(dimensions * 2)
        .map(|label| {
            label
                .chunks_exact(2)
                .map(|value| i16::from_le_bytes([value[0], value[1]]) as f32 / 32767.0)
                .collect()
        })
        .collect())
}

fn parse_image_batch(bytes: &[u8]) -> Result<Vec<&[u8]>, String> {
    if bytes.len() < 4 {
        return Err("元素识别输入无效。".to_string());
    }
    let count = u32::from_le_bytes(bytes[0..4].try_into().unwrap()) as usize;
    let mut offset = 4_usize;
    let mut images = Vec::with_capacity(count.min(1024));
    for _ in 0..count {
        if offset + 4 > bytes.len() {
            return Err("元素识别输入被截断。".to_string());
        }
        let length = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        offset += 4;
        if length == 0
            || offset
                .checked_add(length)
                .filter(|end| *end <= bytes.len())
                .is_none()
        {
            return Err("元素识别图片长度无效。".to_string());
        }
        images.push(&bytes[offset..offset + length]);
        offset += length;
    }
    if offset != bytes.len() {
        return Err("元素识别输入包含多余数据。".to_string());
    }
    Ok(images)
}

fn prepare_siglip(image: &DynamicImage) -> Vec<f32> {
    let resized = image
        .resize_to_fill(SIGLIP_SIZE_PX, SIGLIP_SIZE_PX, FilterType::CatmullRom)
        .to_rgb8();
    let plane = (SIGLIP_SIZE_PX * SIGLIP_SIZE_PX) as usize;
    let mut tensor = vec![0_f32; plane * 3];
    for y in 0..SIGLIP_SIZE_PX {
        for x in 0..SIGLIP_SIZE_PX {
            let pixel = resized.get_pixel(x, y).0;
            let index = (y * SIGLIP_SIZE_PX + x) as usize;
            for channel in 0..3 {
                tensor[channel * plane + index] = pixel[channel] as f32 / 127.5 - 1.0;
            }
        }
    }
    tensor
}

fn cosine_classification(features: &[f32], labels: &[Vec<f32>]) -> Classification {
    let norm = features
        .iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt()
        .max(f32::EPSILON);
    let scores = labels
        .iter()
        .map(|label| {
            label
                .iter()
                .zip(features)
                .map(|(left, right)| left * right / norm)
                .sum::<f32>()
        })
        .collect::<Vec<_>>();
    let max_score = scores.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let probabilities = scores
        .iter()
        .map(|score| ((score - max_score) * 20.0).exp())
        .collect::<Vec<_>>();
    let total = probabilities.iter().sum::<f32>().max(f32::EPSILON);
    let (index, probability) = probabilities
        .iter()
        .copied()
        .enumerate()
        .max_by(|left, right| left.1.total_cmp(&right.1))
        .unwrap_or((SIGLIP_LABELS.len() - 1, 0.0));
    Classification {
        kind: SIGLIP_LABELS[index],
        confidence: (probability / total).clamp(0.0, 1.0),
    }
}

fn classify(app: &AppHandle, bytes: Vec<u8>) -> Result<Response, String> {
    let encoded = parse_image_batch(&bytes)?;
    let state = app.state::<AutoLayerState>();
    let mut loaded = state
        .classifier
        .lock()
        .map_err(|_| "元素识别状态锁已损坏。".to_string())?;
    if loaded.is_none() {
        let path = model_path(app, SIGLIP_FILE)?;
        validate_file(&path, SIGLIP_SIZE, SIGLIP_SHA256, "SigLIP2 命名模型")?;
        *loaded = Some(LoadedClassifier {
            session: create_session(&path, "SigLIP2 命名模型")?,
            label_vectors: load_label_vectors()?,
        });
    }
    let classifier = loaded
        .as_mut()
        .ok_or_else(|| "元素识别会话创建失败。".to_string())?;
    let input_name = classifier
        .session
        .inputs
        .first()
        .map(|input| input.name.clone())
        .ok_or_else(|| "SigLIP 模型缺少输入。".to_string())?;
    let output_name = classifier
        .session
        .outputs
        .iter()
        .find(|output| output.name == "pooler_output")
        .or_else(|| classifier.session.outputs.last())
        .map(|output| output.name.clone())
        .ok_or_else(|| "SigLIP 模型缺少输出。".to_string())?;
    let mut result = Vec::with_capacity(encoded.len());
    for chunk in encoded.chunks(8) {
        let mut input =
            Vec::with_capacity(chunk.len() * 3 * SIGLIP_SIZE_PX as usize * SIGLIP_SIZE_PX as usize);
        for bytes in chunk {
            let image = image::load_from_memory(bytes)
                .map_err(|error| format!("元素图片解码失败：{error}"))?;
            input.extend(prepare_siglip(&image));
        }
        let tensor = Tensor::from_array((
            [
                chunk.len(),
                3,
                SIGLIP_SIZE_PX as usize,
                SIGLIP_SIZE_PX as usize,
            ],
            input,
        ))
        .map_err(|error| format!("创建 SigLIP 输入失败：{error}"))?;
        let outputs = classifier
            .session
            .run(ort::inputs![input_name.as_str() => tensor])
            .map_err(|error| format!("SigLIP 推理失败：{error}"))?;
        let output = outputs
            .get(output_name.as_str())
            .ok_or_else(|| "SigLIP 模型未返回分类特征。".to_string())?;
        let (shape, features) = output
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("SigLIP 输出无效：{error}"))?;
        if shape.len() != 2 || shape[0] != chunk.len() as i64 || shape[1] != 768 {
            return Err(format!("SigLIP 输出尺寸无效：{shape:?}"));
        }
        for feature in features.chunks_exact(768) {
            result.push(cosine_classification(feature, &classifier.label_vectors));
        }
    }
    serde_json::to_vec(&result)
        .map(Response::new)
        .map_err(|error| format!("元素分类结果编码失败：{error}"))
}

fn detector_size(width: u32, height: u32) -> (u32, u32) {
    let scale = (DET_MAX_SIDE as f32 / width.max(height).max(1) as f32).min(1.0);
    let scaled_width = (width as f32 * scale).round().max(1.0) as u32;
    let scaled_height = (height as f32 * scale).round().max(1.0) as u32;
    (
        ((scaled_width + 31) / 32 * 32).max(32),
        ((scaled_height + 31) / 32 * 32).max(32),
    )
}

fn prepare_detector(image: &DynamicImage, width: u32, height: u32) -> Vec<f32> {
    let resized = image
        .resize_exact(width, height, FilterType::Triangle)
        .to_rgb8();
    let plane = (width * height) as usize;
    let mut tensor = vec![0_f32; plane * 3];
    let mean = [0.485_f32, 0.456, 0.406];
    let std = [0.229_f32, 0.224, 0.225];
    for y in 0..height {
        for x in 0..width {
            let pixel = resized.get_pixel(x, y).0;
            let index = (y * width + x) as usize;
            for channel in 0..3 {
                tensor[channel * plane + index] =
                    (pixel[channel] as f32 / 255.0 - mean[channel]) / std[channel];
            }
        }
    }
    tensor
}

fn connected_text_boxes(
    values: &[f32],
    width: usize,
    height: usize,
) -> Vec<(usize, usize, usize, usize)> {
    if values.len() != width * height || width == 0 || height == 0 {
        return Vec::new();
    }
    let probability = |value: f32| {
        if (0.0..=1.0).contains(&value) {
            value
        } else {
            1.0 / (1.0 + (-value).exp())
        }
    };
    let mut binary = vec![false; values.len()];
    for y in 0..height {
        for x in 0..width {
            let mut foreground = false;
            for neighbor_y in y.saturating_sub(1)..=(y + 1).min(height - 1) {
                for neighbor_x in x.saturating_sub(1)..=(x + 1).min(width - 1) {
                    if probability(values[neighbor_y * width + neighbor_x]) >= DET_THRESHOLD {
                        foreground = true;
                    }
                }
            }
            binary[y * width + x] = foreground;
        }
    }

    let mut visited = vec![false; binary.len()];
    let mut boxes = Vec::new();
    for start in 0..binary.len() {
        if !binary[start] || visited[start] {
            continue;
        }
        let mut stack = vec![start];
        visited[start] = true;
        let (mut min_x, mut max_x) = (start % width, start % width);
        let (mut min_y, mut max_y) = (start / width, start / width);
        let mut pixels = 0_usize;
        while let Some(index) = stack.pop() {
            pixels += 1;
            let x = index % width;
            let y = index / width;
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);
            for next_y in y.saturating_sub(1)..=(y + 1).min(height - 1) {
                for next_x in x.saturating_sub(1)..=(x + 1).min(width - 1) {
                    let next = next_y * width + next_x;
                    if binary[next] && !visited[next] {
                        visited[next] = true;
                        stack.push(next);
                    }
                }
            }
        }
        let box_width = max_x - min_x + 1;
        let box_height = max_y - min_y + 1;
        if pixels >= 12 && box_width >= 3 && box_height >= 3 {
            boxes.push((min_x, min_y, max_x + 1, max_y + 1));
        }
    }
    boxes.sort_by_key(|item| (item.1, item.0));
    boxes
}

fn detect_lines(
    session: &mut Session,
    image: &DynamicImage,
) -> Result<Vec<(u32, u32, u32, u32)>, String> {
    let (input_width, input_height) = detector_size(image.width(), image.height());
    let input_name = session
        .inputs
        .first()
        .map(|input| input.name.clone())
        .ok_or_else(|| "OCR 检测模型缺少输入。".to_string())?;
    let output_name = session
        .outputs
        .first()
        .map(|output| output.name.clone())
        .ok_or_else(|| "OCR 检测模型缺少输出。".to_string())?;
    let tensor = Tensor::from_array((
        [1_usize, 3, input_height as usize, input_width as usize],
        prepare_detector(image, input_width, input_height),
    ))
    .map_err(|error| format!("创建 OCR 检测输入失败：{error}"))?;
    let outputs = session
        .run(ort::inputs![input_name.as_str() => tensor])
        .map_err(|error| format!("OCR 文字检测失败：{error}"))?;
    let output = outputs
        .get(output_name.as_str())
        .ok_or_else(|| "OCR 检测模型未返回结果。".to_string())?;
    let (shape, values) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("OCR 检测输出无效：{error}"))?;
    if shape.len() < 2 {
        return Err(format!("OCR 检测输出尺寸无效：{shape:?}"));
    }
    let map_height = shape[shape.len() - 2].max(0) as usize;
    let map_width = shape[shape.len() - 1].max(0) as usize;
    let map_len = map_width * map_height;
    if values.len() < map_len || map_len == 0 {
        return Err("OCR 检测输出数据长度无效。".to_string());
    }
    let scale_x = image.width() as f32 / map_width as f32;
    let scale_y = image.height() as f32 / map_height as f32;
    let mut boxes = connected_text_boxes(&values[values.len() - map_len..], map_width, map_height)
        .into_iter()
        .map(|(left, top, right, bottom)| {
            let x = (left as f32 * scale_x).floor() as u32;
            let y = (top as f32 * scale_y).floor() as u32;
            let right = (right as f32 * scale_x).ceil() as u32;
            let bottom = (bottom as f32 * scale_y).ceil() as u32;
            let padding = ((bottom.saturating_sub(y)) as f32 * 0.08).round().max(2.0) as u32;
            (
                x.saturating_sub(padding),
                y.saturating_sub(padding),
                right.saturating_add(padding).min(image.width()),
                bottom.saturating_add(padding).min(image.height()),
            )
        })
        .collect::<Vec<_>>();
    boxes.sort_by(|left, right| {
        let tolerance = left
            .3
            .saturating_sub(left.1)
            .min(right.3.saturating_sub(right.1))
            / 2;
        if left.1.abs_diff(right.1) <= tolerance {
            left.0.cmp(&right.0)
        } else {
            left.1.cmp(&right.1)
        }
    });
    Ok(boxes)
}

fn prepare_line(image: &DynamicImage, left: u32, top: u32, right: u32, bottom: u32) -> Vec<f32> {
    let width = right.saturating_sub(left).max(1);
    let height = bottom.saturating_sub(top).max(1);
    let crop = image.crop_imm(left, top, width, height).to_rgb8();
    let resized_width = ((crop.width() as f32 * INPUT_HEIGHT as f32 / crop.height().max(1) as f32)
        .round() as u32)
        .clamp(1, INPUT_WIDTH);
    let resized = image::imageops::resize(&crop, resized_width, INPUT_HEIGHT, FilterType::Triangle);
    let plane = (INPUT_WIDTH * INPUT_HEIGHT) as usize;
    let mut tensor = vec![0_f32; plane * 3];
    for y in 0..INPUT_HEIGHT {
        for x in 0..INPUT_WIDTH {
            let pixel = if x < resized_width {
                resized.get_pixel(x, y).0
            } else {
                [255, 255, 255]
            };
            let index = (y * INPUT_WIDTH + x) as usize;
            tensor[index] = pixel[0] as f32 / 127.5 - 1.0;
            tensor[plane + index] = pixel[1] as f32 / 127.5 - 1.0;
            tensor[plane * 2 + index] = pixel[2] as f32 / 127.5 - 1.0;
        }
    }
    tensor
}

fn decode_ctc(
    shape: &[i64],
    values: &[f32],
    characters: &[String],
) -> Result<(String, f32), String> {
    if shape.len() != 3 || shape[0] != 1 || shape[1] <= 0 || shape[2] <= 1 {
        return Err(format!("OCR 输出尺寸无效：{shape:?}"));
    }
    let steps = shape[1] as usize;
    let classes = shape[2] as usize;
    if values.len() != steps * classes {
        return Err("OCR 输出数据长度无效。".to_string());
    }
    let mut previous = 0_usize;
    let mut text = String::new();
    let mut confidence = 0_f32;
    let mut count = 0_usize;
    for step in 0..steps {
        let row = &values[step * classes..(step + 1) * classes];
        let (index, score) = row
            .iter()
            .copied()
            .enumerate()
            .max_by(|left, right| left.1.total_cmp(&right.1))
            .unwrap_or((0, 0.0));
        if index != 0 && index != previous && index < characters.len() {
            text.push_str(&characters[index]);
            confidence += score;
            count += 1;
        }
        previous = index;
    }
    Ok((
        text,
        if count > 0 {
            confidence / count as f32
        } else {
            0.0
        },
    ))
}

fn ensure_ocr_loaded(app: &AppHandle, loaded: &mut Option<LoadedOcr>) -> Result<(), String> {
    if loaded.is_some() {
        return Ok(());
    }
    let det_path = model_path(app, DET_FILE)?;
    let rec_path = model_path(app, REC_FILE)?;
    validate_file(&det_path, DET_SIZE, DET_SHA256, "OCR 检测模型")?;
    validate_file(&rec_path, REC_SIZE, REC_SHA256, "OCR 识别模型")?;
    let characters = parse_characters(&model_path(app, DICTIONARY_FILE)?)?;
    *loaded = Some(LoadedOcr {
        detector: create_session(&det_path, "OCR 检测模型")?,
        recognizer: create_session(&rec_path, "OCR 识别模型")?,
        characters,
    });
    Ok(())
}

fn recognize_box(
    ocr: &mut LoadedOcr,
    image: &DynamicImage,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
) -> Result<(String, f32), String> {
    let input_name = ocr
        .recognizer
        .inputs
        .first()
        .map(|input| input.name.clone())
        .ok_or_else(|| "OCR 模型缺少输入。".to_string())?;
    let output_name = ocr
        .recognizer
        .outputs
        .first()
        .map(|output| output.name.clone())
        .ok_or_else(|| "OCR 模型缺少输出。".to_string())?;
    let tensor = Tensor::from_array((
        [1_usize, 3, INPUT_HEIGHT as usize, INPUT_WIDTH as usize],
        prepare_line(image, left, top, right, bottom),
    ))
    .map_err(|error| format!("创建 OCR 输入失败：{error}"))?;
    let outputs = ocr
        .recognizer
        .run(ort::inputs![input_name.as_str() => tensor])
        .map_err(|error| format!("OCR 推理失败：{error}"))?;
    let output = outputs
        .get(output_name.as_str())
        .ok_or_else(|| "OCR 模型未返回识别结果。".to_string())?;
    let (shape, values) = output
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("OCR 输出无效：{error}"))?;
    decode_ctc(shape, values, &ocr.characters)
}

fn recognize(app: &AppHandle, bytes: Vec<u8>) -> Result<Response, String> {
    let image =
        image::load_from_memory(&bytes).map_err(|error| format!("OCR 图片解码失败：{error}"))?;
    if image.width() == 0
        || image.height() == 0
        || image.width() > 16_384
        || image.height() > 16_384
    {
        return Err("OCR 图片尺寸无效。".to_string());
    }
    let state = app.state::<AutoLayerState>();
    let mut loaded = state
        .ocr
        .lock()
        .map_err(|_| "OCR 状态锁已损坏。".to_string())?;
    ensure_ocr_loaded(app, &mut loaded)?;
    let ocr = loaded
        .as_mut()
        .ok_or_else(|| "OCR 会话创建失败。".to_string())?;
    let detected = detect_lines(&mut ocr.detector, &image)?;
    let mut lines = Vec::new();
    for (left, top, right, bottom) in detected {
        let (text, confidence) = recognize_box(ocr, &image, left, top, right, bottom)?;
        if !text.trim().is_empty() {
            lines.push(OcrLine {
                text,
                confidence,
                x: left,
                y: top,
                width: right - left,
                height: bottom - top,
            });
        }
    }
    serde_json::to_vec(&lines)
        .map(Response::new)
        .map_err(|error| format!("OCR 结果编码失败：{error}"))
}

fn recognize_whole_line(app: &AppHandle, bytes: Vec<u8>) -> Result<Response, String> {
    let image =
        image::load_from_memory(&bytes).map_err(|error| format!("OCR 图片解码失败：{error}"))?;
    if image.width() == 0
        || image.height() == 0
        || image.width() > 16_384
        || image.height() > 16_384
    {
        return Err("OCR 图片尺寸无效。".to_string());
    }
    let state = app.state::<AutoLayerState>();
    let mut loaded = state
        .ocr
        .lock()
        .map_err(|_| "OCR 状态锁已损坏。".to_string())?;
    ensure_ocr_loaded(app, &mut loaded)?;
    let ocr = loaded
        .as_mut()
        .ok_or_else(|| "OCR 会话创建失败。".to_string())?;
    let (text, confidence) = recognize_box(ocr, &image, 0, 0, image.width(), image.height())?;
    let lines = if text.trim().is_empty() {
        Vec::new()
    } else {
        vec![OcrLine {
            text,
            confidence,
            x: 0,
            y: 0,
            width: image.width(),
            height: image.height(),
        }]
    };
    serde_json::to_vec(&lines)
        .map(Response::new)
        .map_err(|error| format!("OCR 结果编码失败：{error}"))
}

#[tauri::command]
pub async fn auto_layer_ocr(app: AppHandle, request: Request<'_>) -> Result<Response, String> {
    let bytes = raw_body(request)?;
    tauri::async_runtime::spawn_blocking(move || recognize(&app, bytes))
        .await
        .map_err(|error| format!("OCR 任务执行失败：{error}"))?
}

#[tauri::command]
pub async fn auto_layer_ocr_line(app: AppHandle, request: Request<'_>) -> Result<Response, String> {
    let bytes = raw_body(request)?;
    tauri::async_runtime::spawn_blocking(move || recognize_whole_line(&app, bytes))
        .await
        .map_err(|error| format!("OCR 单行复核任务执行失败：{error}"))?
}

#[tauri::command]
pub async fn auto_layer_classify(app: AppHandle, request: Request<'_>) -> Result<Response, String> {
    let bytes = raw_body(request)?;
    tauri::async_runtime::spawn_blocking(move || classify(&app, bytes))
        .await
        .map_err(|error| format!("元素分类任务执行失败：{error}"))?
}

#[tauri::command]
pub fn auto_layer_release(state: State<'_, AutoLayerState>) -> Result<(), String> {
    *state
        .ocr
        .lock()
        .map_err(|_| "OCR 状态锁已损坏。".to_string())? = None;
    *state
        .classifier
        .lock()
        .map_err(|_| "元素识别状态锁已损坏。".to_string())? = None;
    Ok(())
}

fn selection_source_path(path: &str) -> Result<PathBuf, String> {
    let requested = PathBuf::from(path.trim());
    if !requested.is_absolute() {
        return Err("选区记录中的原图路径无效。".to_string());
    }
    let extension = requested
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "选区记录中的原图格式无效。".to_string())?;
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp") {
        return Err("选区记录仅支持 PNG、JPEG 和 WebP 原图。".to_string());
    }
    let resolved = requested
        .canonicalize()
        .map_err(|_| "选区记录中的原图已不存在。".to_string())?;
    let metadata = resolved
        .metadata()
        .map_err(|_| "无法读取选区记录中的原图。".to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > SELECTION_SOURCE_MAX_BYTES {
        return Err("选区记录中的原图大小无效。".to_string());
    }
    Ok(resolved)
}

#[tauri::command]
pub fn auto_layer_selection_source_exists(path: String) -> bool {
    selection_source_path(&path).is_ok()
}

#[tauri::command]
pub async fn auto_layer_read_selection_source(path: String) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = selection_source_path(&path)?;
        let bytes =
            fs::read(resolved).map_err(|error| format!("无法读取选区记录中的原图：{error}"))?;
        let format = image::guess_format(&bytes)
            .map_err(|_| "选区记录中的文件不是有效图片。".to_string())?;
        if !matches!(
            format,
            ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
        ) {
            return Err("选区记录中的图片格式不受支持。".to_string());
        }
        Ok(Response::new(bytes))
    })
    .await
    .map_err(|error| format!("读取选区记录原图失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        connected_text_boxes, create_session, decode_ctc, validate_file, DET_FILE, DET_SHA256,
        DET_SIZE, REC_FILE, REC_SHA256, REC_SIZE, SIGLIP_FILE, SIGLIP_SHA256, SIGLIP_SIZE,
    };

    #[test]
    fn ctc_collapses_repeated_characters_and_blanks() {
        let values = vec![0.1, 0.8, 0.1, 0.1, 0.9, 0.0, 0.9, 0.1, 0.0, 0.1, 0.1, 0.8];
        let (text, confidence) =
            decode_ctc(&[1, 4, 3], &values, &["".into(), "A".into(), "B".into()]).unwrap();
        assert_eq!(text, "AB");
        assert!((confidence - 0.8).abs() < 0.001);
    }

    #[test]
    fn detector_postprocess_returns_separate_lines() {
        let mut values = vec![0.0; 12 * 10];
        for y in 1..3 {
            for x in 1..9 {
                values[y * 12 + x] = 0.9;
            }
        }
        for y in 6..9 {
            for x in 2..11 {
                values[y * 12 + x] = 0.9;
            }
        }
        let boxes = connected_text_boxes(&values, 12, 10);
        assert_eq!(boxes.len(), 2);
        assert!(boxes[0].1 < boxes[1].1);
    }

    /// 用已安装资源验证 OCR 与 SigLIP2 的 ONNX 会话和最小推理契约：
    /// AUTO_LAYER_MODEL_DIR=<appDataDir>/models \
    ///   cargo test recognition_models_accept_pinned_files -- --ignored --nocapture
    #[test]
    #[ignore = "需要通过 AUTO_LAYER_MODEL_DIR 指定已安装的自动分层模型目录"]
    fn recognition_models_accept_pinned_files() {
        use ort::value::Tensor;

        let directory = std::path::PathBuf::from(
            std::env::var("AUTO_LAYER_MODEL_DIR")
                .expect("AUTO_LAYER_MODEL_DIR must point to the installed models directory"),
        );
        for (file_name, size, sha256, label) in [
            (DET_FILE, DET_SIZE, DET_SHA256, "OCR 检测模型"),
            (REC_FILE, REC_SIZE, REC_SHA256, "OCR 识别模型"),
            (SIGLIP_FILE, SIGLIP_SIZE, SIGLIP_SHA256, "SigLIP2 命名模型"),
        ] {
            if file_name == SIGLIP_FILE
                && std::env::var_os("AUTO_LAYER_SIGLIP_MODEL_PATH").is_some()
            {
                continue;
            }
            validate_file(&directory.join(file_name), size, sha256, label)
                .unwrap_or_else(|error| panic!("{file_name}: {error}"));
        }

        let classifier_path = std::env::var("AUTO_LAYER_SIGLIP_MODEL_PATH")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| directory.join(SIGLIP_FILE));
        let mut classifier = create_session(&classifier_path, "SigLIP2 命名模型")
            .expect("SigLIP2 session should load");
        let classifier_input = classifier.inputs[0].name.clone();
        let classifier_output = classifier
            .outputs
            .iter()
            .find(|output| output.name == "pooler_output")
            .expect("SigLIP2 pooler_output should exist")
            .name
            .clone();
        let classifier_tensor =
            Tensor::from_array(([1_usize, 3, 224, 224], vec![0.0_f32; 3 * 224 * 224]))
                .expect("SigLIP2 input tensor");
        let classifier_outputs = classifier
            .run(ort::inputs![
                classifier_input.as_str() => classifier_tensor
            ])
            .expect("SigLIP2 inference should run");
        let (classifier_shape, _) = classifier_outputs[classifier_output.as_str()]
            .try_extract_tensor::<f32>()
            .expect("SigLIP2 output should be float32");
        assert_eq!(classifier_shape.as_ref(), &[1, 768]);

        for (file_name, input_shape, input_values) in [
            (DET_FILE, [1_usize, 3, 32, 32], vec![0.0_f32; 3 * 32 * 32]),
            (REC_FILE, [1_usize, 3, 48, 320], vec![0.0_f32; 3 * 48 * 320]),
        ] {
            let mut session = create_session(&directory.join(file_name), file_name)
                .unwrap_or_else(|error| panic!("{file_name} session: {error}"));
            let input_name = session.inputs[0].name.clone();
            let output_name = session.outputs[0].name.clone();
            let tensor = Tensor::from_array((input_shape, input_values))
                .unwrap_or_else(|error| panic!("{file_name} tensor: {error}"));
            let outputs = session
                .run(ort::inputs![input_name.as_str() => tensor])
                .unwrap_or_else(|error| panic!("{file_name} inference: {error}"));
            let (shape, values) = outputs[output_name.as_str()]
                .try_extract_tensor::<f32>()
                .unwrap_or_else(|error| panic!("{file_name} output: {error}"));
            assert!(
                !shape.is_empty(),
                "{file_name} output shape should not be empty"
            );
            assert!(!values.is_empty(), "{file_name} output should not be empty");
            println!("{file_name}: {shape:?}");
        }
    }
}
