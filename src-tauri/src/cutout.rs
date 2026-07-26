use std::{
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
};

use crc32fast::Hasher as Crc32Hasher;
use ort::{
    memory::Allocator,
    session::{builder::GraphOptimizationLevel, run_options::RunOptions, Session},
    value::{Tensor, TensorRef},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, State,
};

const MODELS_DIRECTORY: &str = "models";
const MODEL_READ_BUFFER_BYTES: usize = 1024 * 1024;
const EMBEDDING_OUTPUT_NAMES: [&str; 3] = [
    "image_embeddings.0",
    "image_embeddings.1",
    "image_embeddings.2",
];
const EMBEDDING_SHAPES: [[i64; 4]; 3] = [[1, 32, 256, 256], [1, 64, 128, 128], [1, 256, 64, 64]];
const MASK_LOGIT_TRANSITION_HALF_WIDTH: f32 = 1.0;
const MAX_POINT_PROMPTS: usize = 16;
/// SAM 官方约定的 padding 点标签，decoder 会忽略该点。
const POINT_LABEL_PADDING: i64 = -10;
const REFINER_INPUT_MULTIPLE: usize = 32;
const REFINER_MAX_INPUT_EDGE: usize = 1024;

#[derive(Clone, Copy)]
struct ModelFileSpec {
    file_name: &'static str,
    size_bytes: u64,
    sha256: &'static str,
}

#[derive(Clone, Copy)]
struct ModelSpec {
    id: &'static str,
    encoder: ModelFileSpec,
    encoder_data: ModelFileSpec,
    decoder: ModelFileSpec,
    decoder_data: ModelFileSpec,
    input_width: usize,
    input_height: usize,
    mask_width: usize,
    mask_height: usize,
}

struct ModelPaths {
    encoder: PathBuf,
    encoder_data: PathBuf,
    decoder: PathBuf,
    decoder_data: PathBuf,
}

#[derive(Clone, Copy)]
struct RefinerSpec {
    id: &'static str,
    file_name: &'static str,
    size_bytes: u64,
    crc32: u32,
}

const CUTOUT_MODELS: [ModelSpec; 1] = [ModelSpec {
    id: "sam2.1-hiera-base-plus-quantized",
    encoder: ModelFileSpec {
        file_name: "vision_encoder_quantized.onnx",
        size_bytes: 861_193,
        sha256: "dadc94ee17c53bd55d98d15836cdd7d9d7eb80162d4b8bbcbd10e1a5dfeff50e",
    },
    encoder_data: ModelFileSpec {
        file_name: "vision_encoder_quantized.onnx_data",
        size_bytes: 98_862_416,
        sha256: "ecef22cbdb519a7e153b7e4ddec37e64404229d38f5190bf76db20775c003a79",
    },
    decoder: ModelFileSpec {
        file_name: "prompt_encoder_mask_decoder.onnx",
        size_bytes: 213_114,
        sha256: "f39eeec20243ed1c8f2cd013812e77813d937ddbc800fa4bc703761adc7e63cd",
    },
    decoder_data: ModelFileSpec {
        file_name: "prompt_encoder_mask_decoder.onnx_data",
        size_bytes: 20_958_208,
        sha256: "445cd3f72a218815db10e336f4f1c46a6eb2713a0160a85af5365134607f32a7",
    },
    input_width: 1024,
    input_height: 1024,
    mask_width: 256,
    mask_height: 256,
}];

const CUTOUT_REFINER: RefinerSpec = RefinerSpec {
    id: "vitmatte-small-composition-1k",
    file_name: "cutout-refiner-vitmatte-small.onnx",
    size_bytes: 103_885_865,
    crc32: 0xa0a30d4f,
};

struct ImageEmbeddingFeature {
    shape: Vec<i64>,
    data: Vec<f32>,
}

struct ImageEmbedding {
    id: u64,
    features: Vec<ImageEmbeddingFeature>,
}

struct LoadedModel {
    spec: ModelSpec,
    decoder: Session,
    embedding: ImageEmbedding,
}

struct LoadedRefiner {
    spec: RefinerSpec,
    session: Session,
}

#[derive(Default)]
struct InferenceState {
    loaded: Option<LoadedModel>,
    refiner: Option<LoadedRefiner>,
    next_embedding_id: u64,
}

#[derive(Default)]
pub struct CutoutState {
    inference: Mutex<InferenceState>,
    active_run: Mutex<Option<Arc<RunOptions>>>,
    cancel_epoch: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodeResponse {
    embedding_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeRequest {
    model_id: String,
    embedding_id: String,
    #[serde(default)]
    box_coordinates: Option<[f32; 4]>,
    /// 点提示坐标（encoder 输入坐标系），与 point_labels 一一对应。
    #[serde(default)]
    point_coordinates: Vec<[f32; 2]>,
    /// 1 = 前景点，0 = 背景点。
    #[serde(default)]
    point_labels: Vec<u8>,
    /// true 时返回全部候选遮罩与评分，供分层抠图挑选粒度。
    #[serde(default)]
    return_candidates: bool,
}

impl CutoutState {
    fn inference(&self) -> Result<MutexGuard<'_, InferenceState>, String> {
        self.inference
            .lock()
            .map_err(|_| "原生抠图状态异常，请重启应用后重试。".to_string())
    }

    fn is_cancelled(&self, epoch: u64) -> bool {
        self.cancel_epoch.load(Ordering::SeqCst) != epoch
    }

    fn begin_run(&self, epoch: u64) -> Result<Arc<RunOptions>, String> {
        let options =
            Arc::new(RunOptions::new().map_err(|error| format!("无法创建原生推理任务：{error}"))?);
        {
            let mut active_run = self
                .active_run
                .lock()
                .map_err(|_| "原生抠图状态异常，请重启应用后重试。".to_string())?;
            *active_run = Some(Arc::clone(&options));
        }
        if self.is_cancelled(epoch) {
            let _ = options.terminate();
            self.finish_run(&options);
            return Err(cancelled_error());
        }
        Ok(options)
    }

    fn finish_run(&self, options: &Arc<RunOptions>) {
        if let Ok(mut active_run) = self.active_run.lock() {
            if active_run
                .as_ref()
                .is_some_and(|active| Arc::ptr_eq(active, options))
            {
                *active_run = None;
            }
        }
    }

    fn cancel(&self) {
        self.cancel_epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(active_run) = self.active_run.lock() {
            if let Some(options) = active_run.as_ref() {
                let _ = options.terminate();
            }
        }
    }
}

fn cancelled_error() -> String {
    "抠图已取消。".to_string()
}

fn find_model(model_id: &str) -> Result<ModelSpec, String> {
    CUTOUT_MODELS
        .iter()
        .copied()
        .find(|model| model.id == model_id)
        .ok_or_else(|| "当前抠图模型不受支持。".to_string())
}

fn find_refiner(model_id: &str) -> Result<RefinerSpec, String> {
    if model_id == CUTOUT_REFINER.id {
        Ok(CUTOUT_REFINER)
    } else {
        Err("当前抠图精修模型不受支持。".to_string())
    }
}

fn raw_request_bytes(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err("原生抠图请求必须使用二进制数据。".to_string()),
    }
}

fn parse_encode_request(request: Request<'_>) -> Result<(String, Vec<u8>), String> {
    let model_id = request
        .headers()
        .get("x-cutout-model-id")
        .ok_or_else(|| "原生抠图请求缺少模型标识。".to_string())?
        .to_str()
        .map_err(|_| "原生抠图模型标识无效。".to_string())?
        .to_string();
    Ok((model_id, raw_request_bytes(&request)?))
}

fn parse_refine_request(request: Request<'_>) -> Result<(String, usize, usize, Vec<u8>), String> {
    let header = |name: &str, label: &str| -> Result<String, String> {
        request
            .headers()
            .get(name)
            .ok_or_else(|| format!("原生精修请求缺少{label}。"))?
            .to_str()
            .map(str::to_string)
            .map_err(|_| format!("原生精修请求的{label}无效。"))
    };
    let model_id = header("x-cutout-refiner-id", "模型标识")?;
    let width = header("x-cutout-refiner-width", "输入宽度")?
        .parse::<usize>()
        .map_err(|_| "原生精修请求的输入宽度无效。".to_string())?;
    let height = header("x-cutout-refiner-height", "输入高度")?
        .parse::<usize>()
        .map_err(|_| "原生精修请求的输入高度无效。".to_string())?;
    Ok((model_id, width, height, raw_request_bytes(&request)?))
}

fn models_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let models_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法获取模型目录：{error}"))?
        .join(MODELS_DIRECTORY);
    if let Ok(metadata) = fs::symlink_metadata(&models_dir) {
        if metadata.file_type().is_symlink() {
            return Err("模型目录不能是符号链接。".to_string());
        }
    }
    Ok(models_dir)
}

fn model_paths(app: &AppHandle, spec: ModelSpec) -> Result<ModelPaths, String> {
    let models_dir = models_directory(app)?;
    Ok(ModelPaths {
        encoder: models_dir.join(spec.encoder.file_name),
        encoder_data: models_dir.join(spec.encoder_data.file_name),
        decoder: models_dir.join(spec.decoder.file_name),
        decoder_data: models_dir.join(spec.decoder_data.file_name),
    })
}

fn refiner_path(app: &AppHandle, spec: RefinerSpec) -> Result<PathBuf, String> {
    Ok(models_directory(app)?.join(spec.file_name))
}

fn validate_file_metadata(path: &Path, expected_size: u64, label: &str) -> Result<File, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| format!("{label} 文件不存在，请重新下载模型。"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("{label} 文件类型无效，请重新下载模型。"));
    }
    if metadata.len() != expected_size {
        return Err(format!("{label} 文件不完整，请移除后重新下载模型。"));
    }
    File::open(path).map_err(|error| format!("无法读取 {label}：{error}"))
}

fn validate_sam_model_file(
    path: &Path,
    spec: ModelFileSpec,
    label: &str,
    state: &CutoutState,
    epoch: u64,
) -> Result<(), String> {
    let file = validate_file_metadata(path, spec.size_bytes, label)?;
    let mut reader = BufReader::with_capacity(MODEL_READ_BUFFER_BYTES, file);
    let mut buffer = vec![0_u8; MODEL_READ_BUFFER_BYTES];
    let mut hasher = Sha256::new();
    loop {
        if state.is_cancelled(epoch) {
            return Err(cancelled_error());
        }
        let bytes_read = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取 {label} 时发生错误：{error}"))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    let actual_sha256 = format!("{:x}", hasher.finalize());
    if actual_sha256 != spec.sha256 {
        return Err(format!("{label} 校验失败，请移除后重新下载模型。"));
    }
    Ok(())
}

fn validate_refiner_model_file(
    path: &Path,
    expected_size: u64,
    expected_crc32: u32,
    label: &str,
    state: &CutoutState,
    epoch: u64,
) -> Result<(), String> {
    let file = validate_file_metadata(path, expected_size, label)?;
    let mut reader = BufReader::with_capacity(MODEL_READ_BUFFER_BYTES, file);
    let mut buffer = vec![0_u8; MODEL_READ_BUFFER_BYTES];
    let mut hasher = Crc32Hasher::new();
    loop {
        if state.is_cancelled(epoch) {
            return Err(cancelled_error());
        }
        let bytes_read = reader
            .read(&mut buffer)
            .map_err(|error| format!("读取 {label} 时发生错误：{error}"))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    if hasher.finalize() != expected_crc32 {
        return Err(format!("{label} 校验失败，请移除后重新下载模型。"));
    }
    Ok(())
}

fn native_thread_count() -> usize {
    std::thread::available_parallelism()
        .map(|count| count.get().min(4))
        .unwrap_or(1)
}

fn create_session(path: &Path, label: &str) -> Result<Session, String> {
    Session::builder()
        .and_then(|builder| {
            builder
                .with_optimization_level(GraphOptimizationLevel::Level3)?
                .with_intra_threads(native_thread_count())?
                .with_inter_threads(1)?
                .with_parallel_execution(false)?
                .commit_from_file(path)
        })
        .map_err(|error| format!("加载 {label} 失败：{error}"))
}

fn validate_encoder_contract(session: &Session) -> Result<(), String> {
    let has_input = session
        .inputs
        .iter()
        .any(|input| input.name == "pixel_values");
    let has_outputs = EMBEDDING_OUTPUT_NAMES
        .iter()
        .all(|name| session.outputs.iter().any(|output| output.name == *name));
    if has_input && has_outputs {
        Ok(())
    } else {
        Err("encoder 输入输出与当前抠图协议不兼容。".to_string())
    }
}

fn validate_decoder_contract(session: &Session) -> Result<(), String> {
    const REQUIRED_INPUTS: [&str; 6] = [
        "input_points",
        "input_labels",
        "input_boxes",
        "image_embeddings.0",
        "image_embeddings.1",
        "image_embeddings.2",
    ];
    let has_inputs = REQUIRED_INPUTS
        .iter()
        .all(|name| session.inputs.iter().any(|input| input.name == *name));
    let has_masks = session
        .outputs
        .iter()
        .any(|output| output.name == "pred_masks");
    let has_iou_scores = session
        .outputs
        .iter()
        .any(|output| output.name == "iou_scores");
    if has_inputs && has_masks && has_iou_scores {
        Ok(())
    } else {
        Err("decoder 输入输出与当前抠图协议不兼容。".to_string())
    }
}

fn validate_refiner_contract(session: &Session) -> Result<(), String> {
    let has_input = session
        .inputs
        .iter()
        .any(|input| input.name == "pixel_values");
    let has_output = session.outputs.iter().any(|output| output.name == "alphas");
    if has_input && has_output {
        Ok(())
    } else {
        Err("精修模型输入输出与当前抠图协议不兼容。".to_string())
    }
}

fn decode_float_bytes(bytes: Vec<u8>, expected_values: usize) -> Result<Vec<f32>, String> {
    let expected_bytes = expected_values
        .checked_mul(std::mem::size_of::<f32>())
        .ok_or_else(|| "原生抠图输入尺寸无效。".to_string())?;
    if bytes.len() != expected_bytes {
        return Err(format!(
            "原生抠图输入不完整（预期 {expected_bytes} 字节，实际 {} 字节）。",
            bytes.len()
        ));
    }

    let mut values = Vec::with_capacity(expected_values);
    for chunk in bytes.chunks_exact(4) {
        let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        if !value.is_finite() || !(-4.0..=4.0).contains(&value) {
            return Err("原生抠图输入包含无效像素。".to_string());
        }
        values.push(value);
    }
    Ok(values)
}

fn validate_refiner_dimensions(width: usize, height: usize) -> Result<usize, String> {
    if width == 0
        || height == 0
        || width > REFINER_MAX_INPUT_EDGE
        || height > REFINER_MAX_INPUT_EDGE
        || !width.is_multiple_of(REFINER_INPUT_MULTIPLE)
        || !height.is_multiple_of(REFINER_INPUT_MULTIPLE)
    {
        return Err("精修模型输入尺寸无效。".to_string());
    }
    width
        .checked_mul(height)
        .ok_or_else(|| "精修模型输入尺寸无效。".to_string())
}

fn decode_refiner_float_bytes(
    bytes: Vec<u8>,
    width: usize,
    height: usize,
) -> Result<Vec<f32>, String> {
    let plane_size = validate_refiner_dimensions(width, height)?;
    let expected_values = plane_size
        .checked_mul(4)
        .ok_or_else(|| "精修模型输入尺寸无效。".to_string())?;
    let expected_bytes = expected_values
        .checked_mul(std::mem::size_of::<f32>())
        .ok_or_else(|| "精修模型输入尺寸无效。".to_string())?;
    if bytes.len() != expected_bytes {
        return Err(format!(
            "精修模型输入不完整（预期 {expected_bytes} 字节，实际 {} 字节）。",
            bytes.len()
        ));
    }

    let mut values = Vec::with_capacity(expected_values);
    for chunk in bytes.chunks_exact(4) {
        let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        if !value.is_finite() || !(-1.0..=1.0).contains(&value) {
            return Err("精修模型输入包含无效像素。".to_string());
        }
        values.push(value);
    }
    Ok(values)
}

fn encode_image(
    app: &AppHandle,
    model_id: String,
    bytes: Vec<u8>,
) -> Result<EncodeResponse, String> {
    let state = app.state::<CutoutState>();
    let epoch = state.cancel_epoch.load(Ordering::SeqCst);
    let spec = find_model(&model_id)?;
    let input_values = spec
        .input_width
        .checked_mul(spec.input_height)
        .and_then(|pixels| pixels.checked_mul(3))
        .ok_or_else(|| "原生抠图输入尺寸无效。".to_string())?;
    let input = decode_float_bytes(bytes, input_values)?;
    if state.is_cancelled(epoch) {
        return Err(cancelled_error());
    }

    let mut inference = state.inference()?;
    inference.loaded = None;
    inference.refiner = None;
    let paths = model_paths(app, spec)?;
    for (path, file, label) in [
        (&paths.encoder, spec.encoder, "SAM 2.1 encoder"),
        (
            &paths.encoder_data,
            spec.encoder_data,
            "SAM 2.1 encoder 权重",
        ),
        (&paths.decoder, spec.decoder, "SAM 2.1 decoder"),
        (
            &paths.decoder_data,
            spec.decoder_data,
            "SAM 2.1 decoder 权重",
        ),
    ] {
        validate_sam_model_file(path, file, label, &state, epoch)?;
    }

    let mut encoder = create_session(&paths.encoder, "SAM 2.1 encoder")?;
    validate_encoder_contract(&encoder)?;
    if state.is_cancelled(epoch) {
        return Err(cancelled_error());
    }

    let input_tensor =
        Tensor::from_array(([1_usize, 3, spec.input_height, spec.input_width], input))
            .map_err(|error| format!("无法创建 encoder 输入：{error}"))?;
    let run_options = state.begin_run(epoch)?;
    let outputs = encoder.run_with_options(
        ort::inputs! { "pixel_values" => input_tensor },
        run_options.as_ref(),
    );
    state.finish_run(&run_options);
    let outputs = outputs.map_err(|error| {
        if state.is_cancelled(epoch) {
            cancelled_error()
        } else {
            format!("encoder 推理失败：{error}")
        }
    })?;
    if state.is_cancelled(epoch) {
        return Err(cancelled_error());
    }

    let mut features = Vec::with_capacity(EMBEDDING_OUTPUT_NAMES.len());
    for (index, name) in EMBEDDING_OUTPUT_NAMES.iter().enumerate() {
        let embedding_value = outputs
            .get(*name)
            .ok_or_else(|| format!("encoder 未返回图像特征 {name}。"))?;
        let (shape, data) = embedding_value
            .try_extract_tensor::<f32>()
            .map_err(|error| format!("encoder 图像特征 {name} 无效：{error}"))?;
        if **shape != EMBEDDING_SHAPES[index] {
            return Err(format!("encoder 图像特征 {name} 尺寸不兼容：{shape}。"));
        }
        features.push(ImageEmbeddingFeature {
            shape: shape.to_vec(),
            data: data.to_vec(),
        });
    }
    drop(outputs);
    drop(encoder);

    let decoder = create_session(&paths.decoder, "SAM 2.1 decoder")?;
    validate_decoder_contract(&decoder)?;
    if state.is_cancelled(epoch) {
        return Err(cancelled_error());
    }

    inference.next_embedding_id = inference.next_embedding_id.wrapping_add(1).max(1);
    let embedding_id = inference.next_embedding_id;
    inference.loaded = Some(LoadedModel {
        spec,
        decoder,
        embedding: ImageEmbedding {
            id: embedding_id,
            features,
        },
    });

    Ok(EncodeResponse {
        embedding_id: embedding_id.to_string(),
    })
}

fn validate_box_coordinates(spec: ModelSpec, coordinates: [f32; 4]) -> Result<(), String> {
    if coordinates.iter().any(|value| !value.is_finite()) {
        return Err("框选坐标无效。".to_string());
    }
    let [x1, y1, x2, y2] = coordinates;
    if x1 < 0.0
        || y1 < 0.0
        || x2 > spec.input_width as f32
        || y2 > spec.input_height as f32
        || x2 <= x1
        || y2 <= y1
    {
        return Err("框选坐标超出图片范围。".to_string());
    }
    Ok(())
}

fn validate_prompts(spec: ModelSpec, request: &DecodeRequest) -> Result<(), String> {
    if let Some(coordinates) = request.box_coordinates {
        validate_box_coordinates(spec, coordinates)?;
    } else if request.point_coordinates.is_empty() {
        return Err("抠图请求缺少框选或点选提示。".to_string());
    }
    if request.point_coordinates.len() > MAX_POINT_PROMPTS {
        return Err("点选提示数量超出限制。".to_string());
    }
    if request.point_labels.len() != request.point_coordinates.len() {
        return Err("点选标签数量与坐标数量不匹配。".to_string());
    }
    for [x, y] in &request.point_coordinates {
        if !x.is_finite()
            || !y.is_finite()
            || *x < 0.0
            || *y < 0.0
            || *x > spec.input_width as f32
            || *y > spec.input_height as f32
        {
            return Err("点选坐标超出图片范围。".to_string());
        }
    }
    if request.point_labels.iter().any(|label| *label > 1) {
        return Err("点选标签无效。".to_string());
    }
    Ok(())
}

fn mask_logit_to_alpha(logit: f32) -> u8 {
    let normalized = ((logit + MASK_LOGIT_TRANSITION_HALF_WIDTH)
        / (2.0 * MASK_LOGIT_TRANSITION_HALF_WIDTH))
        .clamp(0.0, 1.0);
    let smoothed = normalized * normalized * (3.0 - 2.0 * normalized);
    (smoothed * u8::MAX as f32).round() as u8
}

/// 校验 decoder 输出布局，返回（候选数量, 单张遮罩像素数）。
fn candidate_mask_layout(
    mask_shape: &[i64],
    mask_data_len: usize,
    iou_count: usize,
    expected_width: usize,
    expected_height: usize,
) -> Result<(usize, usize), String> {
    if mask_shape.len() < 2 {
        return Err("decoder 返回的遮罩尺寸无效。".to_string());
    }

    let mask_height = usize::try_from(mask_shape[mask_shape.len() - 2])
        .map_err(|_| "decoder 返回的遮罩尺寸无效。".to_string())?;
    let mask_width = usize::try_from(mask_shape[mask_shape.len() - 1])
        .map_err(|_| "decoder 返回的遮罩尺寸无效。".to_string())?;
    if mask_width != expected_width || mask_height != expected_height {
        return Err(format!(
            "decoder 返回了不兼容的遮罩尺寸：{mask_width}x{mask_height}。"
        ));
    }

    let candidate_count =
        mask_shape[..mask_shape.len() - 2]
            .iter()
            .try_fold(1_usize, |count, dimension| {
                let dimension = usize::try_from(*dimension)
                    .map_err(|_| "decoder 返回的遮罩候选数量无效。".to_string())?;
                count
                    .checked_mul(dimension)
                    .ok_or_else(|| "decoder 返回的遮罩候选数量无效。".to_string())
            })?;
    if candidate_count == 0 {
        return Err("decoder 没有返回可用的遮罩候选。".to_string());
    }

    let plane_size = mask_width
        .checked_mul(mask_height)
        .ok_or_else(|| "decoder 返回的遮罩尺寸无效。".to_string())?;
    let expected_values = candidate_count
        .checked_mul(plane_size)
        .ok_or_else(|| "decoder 返回的遮罩数据尺寸无效。".to_string())?;
    if mask_data_len != expected_values {
        return Err("decoder 返回的遮罩数据不完整。".to_string());
    }
    if iou_count != candidate_count {
        return Err("decoder 返回的遮罩评分数量不匹配。".to_string());
    }
    Ok((candidate_count, plane_size))
}

fn select_best_mask_alpha(
    mask_shape: &[i64],
    mask_data: &[f32],
    iou_scores: &[f32],
    expected_width: usize,
    expected_height: usize,
) -> Result<Vec<u8>, String> {
    let (_, plane_size) = candidate_mask_layout(
        mask_shape,
        mask_data.len(),
        iou_scores.len(),
        expected_width,
        expected_height,
    )?;

    let mut best_candidate = 0_usize;
    let mut best_score = f32::NEG_INFINITY;
    for (candidate, score) in iou_scores.iter().copied().enumerate() {
        if !score.is_finite() {
            return Err("decoder 返回了无效的遮罩评分。".to_string());
        }
        if score > best_score {
            best_candidate = candidate;
            best_score = score;
        }
    }

    let plane_start = best_candidate * plane_size;
    let plane = &mask_data[plane_start..plane_start + plane_size];
    if plane.iter().any(|value| !value.is_finite()) {
        return Err("decoder 返回了无效的遮罩数据。".to_string());
    }
    Ok(plane.iter().copied().map(mask_logit_to_alpha).collect())
}

/// 多候选响应布局：[候选数 u8][每候选 IoU 评分 f32 LE][每候选 alpha 平面 u8]。
fn encode_candidate_response(
    mask_shape: &[i64],
    mask_data: &[f32],
    iou_scores: &[f32],
    expected_width: usize,
    expected_height: usize,
) -> Result<Vec<u8>, String> {
    let (candidate_count, plane_size) = candidate_mask_layout(
        mask_shape,
        mask_data.len(),
        iou_scores.len(),
        expected_width,
        expected_height,
    )?;
    if candidate_count > usize::from(u8::MAX) {
        return Err("decoder 返回的遮罩候选数量无效。".to_string());
    }

    let mut bytes =
        Vec::with_capacity(1 + candidate_count * std::mem::size_of::<f32>() + mask_data.len());
    bytes.push(candidate_count as u8);
    for score in iou_scores {
        if !score.is_finite() {
            return Err("decoder 返回了无效的遮罩评分。".to_string());
        }
        bytes.extend_from_slice(&score.to_le_bytes());
    }
    for candidate in 0..candidate_count {
        let plane = &mask_data[candidate * plane_size..(candidate + 1) * plane_size];
        if plane.iter().any(|value| !value.is_finite()) {
            return Err("decoder 返回了无效的遮罩数据。".to_string());
        }
        bytes.extend(plane.iter().copied().map(mask_logit_to_alpha));
    }
    Ok(bytes)
}

fn refiner_output_alpha(
    shape: &[i64],
    values: &[f32],
    width: usize,
    height: usize,
) -> Result<Vec<u8>, String> {
    let expected_shape = [1_i64, 1, height as i64, width as i64];
    let plane_size = validate_refiner_dimensions(width, height)?;
    if shape != expected_shape || values.len() != plane_size {
        return Err(format!("精修模型返回了不兼容的 alpha 尺寸：{shape:?}。"));
    }
    if values.iter().any(|value| !value.is_finite()) {
        return Err("精修模型返回了无效的 alpha 数据。".to_string());
    }
    Ok(values
        .iter()
        .map(|value| (value.clamp(0.0, 1.0) * u8::MAX as f32).round() as u8)
        .collect())
}

fn decode_mask(app: &AppHandle, request: DecodeRequest) -> Result<Response, String> {
    let state = app.state::<CutoutState>();
    let epoch = state.cancel_epoch.load(Ordering::SeqCst);
    let requested_spec = find_model(&request.model_id)?;
    validate_prompts(requested_spec, &request)?;
    let embedding_id = request
        .embedding_id
        .parse::<u64>()
        .map_err(|_| "图片特征标识无效，请重新执行抠图。".to_string())?;

    let mut inference = state.inference()?;
    let loaded = inference
        .loaded
        .as_mut()
        .ok_or_else(|| "图片特征已释放，请重新执行抠图。".to_string())?;
    if loaded.spec.id != requested_spec.id || loaded.embedding.id != embedding_id {
        return Err("图片特征与当前模型不匹配，请重新执行抠图。".to_string());
    }
    if state.is_cancelled(epoch) {
        return Err(cancelled_error());
    }

    let LoadedModel {
        spec,
        decoder,
        embedding,
    } = loaded;
    let [feature_0, feature_1, feature_2] = embedding.features.as_slice() else {
        return Err("图片特征数量无效，请重新执行抠图。".to_string());
    };
    let embedding_0 =
        TensorRef::from_array_view((feature_0.shape.as_slice(), feature_0.data.as_slice()))
            .map_err(|error| format!("无法读取图像特征 0：{error}"))?;
    let embedding_1 =
        TensorRef::from_array_view((feature_1.shape.as_slice(), feature_1.data.as_slice()))
            .map_err(|error| format!("无法读取图像特征 1：{error}"))?;
    let embedding_2 =
        TensorRef::from_array_view((feature_2.shape.as_slice(), feature_2.data.as_slice()))
            .map_err(|error| format!("无法读取图像特征 2：{error}"))?;
    // 无点提示时沿用 padding 点占位；无框提示时传空框（[1, 0, 4]）。
    let (point_values, label_values) = if request.point_coordinates.is_empty() {
        (vec![0.0_f32, 0.0], vec![POINT_LABEL_PADDING])
    } else {
        let points = request
            .point_coordinates
            .iter()
            .flat_map(|point| point.iter().copied())
            .collect::<Vec<f32>>();
        let labels = request
            .point_labels
            .iter()
            .map(|label| i64::from(*label))
            .collect::<Vec<i64>>();
        (points, labels)
    };
    let point_count = label_values.len();
    let input_points = Tensor::from_array(([1_usize, 1, point_count, 2], point_values))
        .map_err(|error| format!("无法创建点选坐标：{error}"))?;
    let input_labels = Tensor::from_array(([1_usize, 1, point_count], label_values))
        .map_err(|error| format!("无法创建点选标签：{error}"))?;
    let input_boxes = match request.box_coordinates {
        Some([x1, y1, x2, y2]) => Tensor::from_array(([1_usize, 1, 4], vec![x1, y1, x2, y2]))
            .map_err(|error| format!("无法创建框选坐标：{error}"))?,
        // from_array 拒绝 0 尺寸维度，空框需走 allocator 构造。
        None => Tensor::<f32>::new(&Allocator::default(), [1_i64, 0, 4])
            .map_err(|error| format!("无法创建空框选输入：{error}"))?,
    };

    let run_options = state.begin_run(epoch)?;
    let outputs = decoder.run_with_options(
        ort::inputs! {
            "input_points" => input_points,
            "input_labels" => input_labels,
            "input_boxes" => input_boxes,
            "image_embeddings.0" => embedding_0,
            "image_embeddings.1" => embedding_1,
            "image_embeddings.2" => embedding_2
        },
        run_options.as_ref(),
    );
    state.finish_run(&run_options);
    let outputs = outputs.map_err(|error| {
        if state.is_cancelled(epoch) {
            cancelled_error()
        } else {
            format!("decoder 推理失败：{error}")
        }
    })?;
    if state.is_cancelled(epoch) {
        return Err(cancelled_error());
    }

    let masks = outputs
        .get("pred_masks")
        .ok_or_else(|| "decoder 未返回分割遮罩。".to_string())?;
    let (mask_shape, mask_data) = masks
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("decoder 分割遮罩无效：{error}"))?;
    let iou_scores = outputs
        .get("iou_scores")
        .ok_or_else(|| "decoder 未返回遮罩评分。".to_string())?;
    let (_, iou_data) = iou_scores
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("decoder 遮罩评分无效：{error}"))?;
    let payload = if request.return_candidates {
        encode_candidate_response(
            mask_shape,
            mask_data,
            iou_data,
            spec.mask_width,
            spec.mask_height,
        )?
    } else {
        select_best_mask_alpha(
            mask_shape,
            mask_data,
            iou_data,
            spec.mask_width,
            spec.mask_height,
        )?
    };
    Ok(Response::new(payload))
}

fn refine_mask(
    app: &AppHandle,
    model_id: String,
    width: usize,
    height: usize,
    bytes: Vec<u8>,
) -> Result<Response, String> {
    let state = app.state::<CutoutState>();
    let epoch = state.cancel_epoch.load(Ordering::SeqCst);
    let spec = find_refiner(&model_id)?;
    let input = decode_refiner_float_bytes(bytes, width, height)?;
    if state.is_cancelled(epoch) {
        return Err(cancelled_error());
    }

    let mut inference = state.inference()?;
    if inference
        .refiner
        .as_ref()
        .is_none_or(|loaded| loaded.spec.id != spec.id)
    {
        inference.refiner = None;
        let path = refiner_path(app, spec)?;
        validate_refiner_model_file(
            &path,
            spec.size_bytes,
            spec.crc32,
            "精修模型",
            &state,
            epoch,
        )?;
        let session = create_session(&path, "精修模型")?;
        validate_refiner_contract(&session)?;
        inference.refiner = Some(LoadedRefiner { spec, session });
    }
    if state.is_cancelled(epoch) {
        return Err(cancelled_error());
    }

    let refiner = inference
        .refiner
        .as_mut()
        .ok_or_else(|| "精修模型会话创建失败。".to_string())?;
    let input_tensor = Tensor::from_array(([1_usize, 4, height, width], input))
        .map_err(|error| format!("无法创建精修模型输入：{error}"))?;
    let run_options = state.begin_run(epoch)?;
    let outputs = refiner.session.run_with_options(
        ort::inputs! { "pixel_values" => input_tensor },
        run_options.as_ref(),
    );
    state.finish_run(&run_options);
    let outputs = outputs.map_err(|error| {
        if state.is_cancelled(epoch) {
            cancelled_error()
        } else {
            format!("精修模型推理失败：{error}")
        }
    })?;
    if state.is_cancelled(epoch) {
        return Err(cancelled_error());
    }

    let alphas = outputs
        .get("alphas")
        .ok_or_else(|| "精修模型未返回 alpha。".to_string())?;
    let (shape, values) = alphas
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("精修模型 alpha 无效：{error}"))?;
    Ok(Response::new(refiner_output_alpha(
        shape, values, width, height,
    )?))
}

#[tauri::command]
pub async fn cutout_encode(app: AppHandle, request: Request<'_>) -> Result<EncodeResponse, String> {
    let (model_id, bytes) = parse_encode_request(request)?;
    let task_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || encode_image(&task_app, model_id, bytes))
        .await
        .map_err(|error| format!("原生 encoder 任务异常结束：{error}"))?
}

#[tauri::command]
pub async fn cutout_decode(app: AppHandle, request: DecodeRequest) -> Result<Response, String> {
    let task_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || decode_mask(&task_app, request))
        .await
        .map_err(|error| format!("原生 decoder 任务异常结束：{error}"))?
}

#[tauri::command]
pub async fn cutout_refine(app: AppHandle, request: Request<'_>) -> Result<Response, String> {
    let (model_id, width, height, bytes) = parse_refine_request(request)?;
    let task_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        refine_mask(&task_app, model_id, width, height, bytes)
    })
    .await
    .map_err(|error| format!("原生精修任务异常结束：{error}"))?
}

#[tauri::command]
pub fn cutout_cancel(state: State<'_, CutoutState>) {
    state.cancel();
}

#[tauri::command]
pub async fn cutout_release(app: AppHandle, model_id: Option<String>) -> Result<(), String> {
    if let Some(model_id) = model_id.as_deref() {
        find_model(model_id)?;
    }
    app.state::<CutoutState>().cancel();
    let task_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = task_app.state::<CutoutState>();
        let mut inference = state.inference()?;
        let should_release = model_id.as_deref().is_none_or(|model_id| {
            inference
                .loaded
                .as_ref()
                .is_some_and(|loaded| loaded.spec.id == model_id)
        });
        if should_release {
            inference.loaded = None;
        }
        inference.refiner = None;
        Ok(())
    })
    .await
    .map_err(|error| format!("释放原生模型任务异常结束：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        encode_candidate_response, mask_logit_to_alpha, refiner_output_alpha,
        select_best_mask_alpha, validate_prompts, DecodeRequest, CUTOUT_MODELS,
    };

    fn decode_request(
        box_coordinates: Option<[f32; 4]>,
        point_coordinates: Vec<[f32; 2]>,
        point_labels: Vec<u8>,
    ) -> DecodeRequest {
        DecodeRequest {
            model_id: CUTOUT_MODELS[0].id.to_string(),
            embedding_id: "1".to_string(),
            box_coordinates,
            point_coordinates,
            point_labels,
            return_candidates: false,
        }
    }

    #[test]
    fn accepts_box_only_point_only_and_combined_prompts() {
        let spec = CUTOUT_MODELS[0];
        let box_only = decode_request(Some([0.0, 0.0, 100.0, 100.0]), Vec::new(), Vec::new());
        let point_only = decode_request(None, vec![[512.0, 512.0]], vec![1]);
        let combined = decode_request(
            Some([0.0, 0.0, 100.0, 100.0]),
            vec![[50.0, 50.0], [10.0, 10.0]],
            vec![1, 0],
        );

        assert!(validate_prompts(spec, &box_only).is_ok());
        assert!(validate_prompts(spec, &point_only).is_ok());
        assert!(validate_prompts(spec, &combined).is_ok());
    }

    #[test]
    fn rejects_invalid_prompts() {
        let spec = CUTOUT_MODELS[0];
        let empty = decode_request(None, Vec::new(), Vec::new());
        let label_mismatch = decode_request(None, vec![[1.0, 1.0]], Vec::new());
        let out_of_range = decode_request(None, vec![[2048.0, 0.0]], vec![1]);
        let invalid_label = decode_request(None, vec![[1.0, 1.0]], vec![2]);
        let too_many = decode_request(None, vec![[1.0, 1.0]; 17], vec![1; 17]);

        assert_eq!(
            validate_prompts(spec, &empty),
            Err("抠图请求缺少框选或点选提示。".to_string())
        );
        assert_eq!(
            validate_prompts(spec, &label_mismatch),
            Err("点选标签数量与坐标数量不匹配。".to_string())
        );
        assert_eq!(
            validate_prompts(spec, &out_of_range),
            Err("点选坐标超出图片范围。".to_string())
        );
        assert_eq!(
            validate_prompts(spec, &invalid_label),
            Err("点选标签无效。".to_string())
        );
        assert_eq!(
            validate_prompts(spec, &too_many),
            Err("点选提示数量超出限制。".to_string())
        );
    }

    #[test]
    fn encodes_all_candidates_with_scores() {
        let mask_shape = [1, 1, 3, 2, 2];
        let mask_data = [
            -2.0, -2.0, -2.0, -2.0, // candidate 1
            -2.0, 0.0, 2.0, 1.0, // candidate 2
            2.0, 2.0, 2.0, 2.0, // candidate 3
        ];
        let scores = [0.2_f32, 0.9, 0.5];
        let bytes = encode_candidate_response(&mask_shape, &mask_data, &scores, 2, 2)
            .expect("candidate encoding should succeed");

        assert_eq!(bytes.len(), 1 + 3 * 4 + 3 * 4);
        assert_eq!(bytes[0], 3);
        for (index, score) in scores.iter().enumerate() {
            let offset = 1 + index * 4;
            let decoded = f32::from_le_bytes([
                bytes[offset],
                bytes[offset + 1],
                bytes[offset + 2],
                bytes[offset + 3],
            ]);
            assert_eq!(decoded, *score);
        }
        let planes_offset = 1 + 3 * 4;
        assert_eq!(bytes[planes_offset..planes_offset + 4], [0, 0, 0, 0]);
        assert_eq!(bytes[planes_offset + 4..planes_offset + 8], [0, 128, 255, 255]);
        assert_eq!(bytes[planes_offset + 8..], [255, 255, 255, 255]);
    }

    #[test]
    fn rejects_mismatched_candidate_scores_when_encoding() {
        let error = encode_candidate_response(&[1, 1, 2, 1, 1], &[0.0, 1.0], &[0.5], 1, 1)
            .expect_err("score count should be validated");

        assert_eq!(error, "decoder 返回的遮罩评分数量不匹配。");
    }

    /// 用本机已安装的 SAM 2.1 decoder 验证空框 + 纯点提示可被 ONNX 图接受：
    /// CUTOUT_DECODER_PATH=<models 目录>/prompt_encoder_mask_decoder.onnx \
    ///   cargo test decoder_accepts_point_only_prompt -- --ignored --nocapture
    #[test]
    #[ignore = "需要本机 SAM 2.1 decoder 模型文件"]
    fn decoder_accepts_point_only_prompt() {
        use ort::{memory::Allocator, value::Tensor};

        let path = std::env::var("CUTOUT_DECODER_PATH")
            .expect("请通过 CUTOUT_DECODER_PATH 指定 decoder onnx 路径");
        let mut session =
            super::create_session(std::path::Path::new(&path), "SAM 2.1 decoder")
                .expect("decoder session");
        super::validate_decoder_contract(&session).expect("decoder contract");

        let [embedding_0, embedding_1, embedding_2] = super::EMBEDDING_SHAPES.map(|shape| {
            let dimensions = shape.map(|dimension| dimension as usize);
            let count = dimensions.iter().product::<usize>();
            Tensor::from_array((dimensions, vec![0.0_f32; count])).expect("embedding tensor")
        });
        let input_points =
            Tensor::from_array(([1_usize, 1, 2, 2], vec![512.0_f32, 512.0, 300.0, 300.0]))
                .expect("points tensor");
        let input_labels =
            Tensor::from_array(([1_usize, 1, 2], vec![1_i64, 0])).expect("labels tensor");
        let input_boxes = Tensor::<f32>::new(&Allocator::default(), [1_i64, 0, 4])
            .expect("empty boxes tensor");

        let outputs = session
            .run(ort::inputs! {
                "input_points" => input_points,
                "input_labels" => input_labels,
                "input_boxes" => input_boxes,
                "image_embeddings.0" => embedding_0,
                "image_embeddings.1" => embedding_1,
                "image_embeddings.2" => embedding_2
            })
            .expect("point-only decode should run");

        let (mask_shape, mask_data) = outputs
            .get("pred_masks")
            .expect("pred_masks output")
            .try_extract_tensor::<f32>()
            .expect("masks tensor");
        let (_, iou_data) = outputs
            .get("iou_scores")
            .expect("iou_scores output")
            .try_extract_tensor::<f32>()
            .expect("scores tensor");
        let (candidate_count, plane_size) = super::candidate_mask_layout(
            mask_shape,
            mask_data.len(),
            iou_data.len(),
            256,
            256,
        )
        .expect("candidate layout");

        println!("candidates: {candidate_count}, plane: {plane_size}, scores: {iou_data:?}");
        assert!(candidate_count >= 1);
    }

    #[test]
    fn converts_mask_logits_to_soft_alpha() {
        assert_eq!(mask_logit_to_alpha(-2.0), 0);
        assert_eq!(mask_logit_to_alpha(-1.0), 0);
        assert_eq!(mask_logit_to_alpha(0.0), 128);
        assert_eq!(mask_logit_to_alpha(1.0), 255);
        assert_eq!(mask_logit_to_alpha(2.0), 255);
    }

    #[test]
    fn selects_candidate_with_highest_iou_score() {
        let mask_shape = [1, 1, 3, 2, 2];
        let mask_data = [
            -2.0, -2.0, -2.0, -2.0, // candidate 1
            -2.0, 0.0, 2.0, 1.0, // candidate 2
            2.0, 2.0, 2.0, 2.0, // candidate 3
        ];
        let alpha = select_best_mask_alpha(&mask_shape, &mask_data, &[0.2, 0.9, 0.5], 2, 2)
            .expect("candidate selection should succeed");

        assert_eq!(alpha, vec![0, 128, 255, 255]);
    }

    #[test]
    fn rejects_mismatched_candidate_scores() {
        let error = select_best_mask_alpha(&[1, 1, 2, 1, 1], &[0.0, 1.0], &[0.5], 1, 1)
            .expect_err("score count should be validated");

        assert_eq!(error, "decoder 返回的遮罩评分数量不匹配。");
    }

    #[test]
    fn converts_and_clamps_refiner_alpha() {
        let mut values = vec![0.5_f32; 32 * 32];
        values[0] = -0.2;
        values[1] = 1.2;
        let alpha = refiner_output_alpha(&[1, 1, 32, 32], &values, 32, 32)
            .expect("refiner output should be accepted");

        assert_eq!(alpha[0], 0);
        assert_eq!(alpha[1], 255);
        assert_eq!(alpha[2], 128);
    }

    #[test]
    fn rejects_invalid_refiner_output_shape() {
        let error = refiner_output_alpha(&[1, 2, 32, 32], &[0.0; 32 * 32], 32, 32)
            .expect_err("refiner output shape should be validated");

        assert!(error.contains("不兼容的 alpha 尺寸"));
    }
}
