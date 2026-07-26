use std::{
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
};

use crc32fast::Hasher;
use ort::{
    session::{builder::GraphOptimizationLevel, run_options::RunOptions, Session},
    value::{Tensor, TensorRef},
};
use serde::{Deserialize, Serialize};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    AppHandle, Manager, State,
};

const MODELS_DIRECTORY: &str = "models";
const MODEL_READ_BUFFER_BYTES: usize = 1024 * 1024;
const EMBEDDING_SHAPE: [i64; 4] = [1, 256, 64, 64];
const MASK_LOGIT_TRANSITION_HALF_WIDTH: f32 = 1.0;
const REFINER_INPUT_MULTIPLE: usize = 32;
const REFINER_MAX_INPUT_EDGE: usize = 1024;

#[derive(Clone, Copy)]
struct ModelSpec {
    id: &'static str,
    encoder_file_name: &'static str,
    decoder_file_name: &'static str,
    encoder_size_bytes: u64,
    encoder_crc32: u32,
    decoder_size_bytes: u64,
    decoder_crc32: u32,
    input_width: usize,
    input_height: usize,
}

#[derive(Clone, Copy)]
struct RefinerSpec {
    id: &'static str,
    file_name: &'static str,
    size_bytes: u64,
    crc32: u32,
}

const CUTOUT_MODELS: [ModelSpec; 1] = [ModelSpec {
    id: "sam-vit-h-quant",
    encoder_file_name: "sam-vit-h-quant.encoder.onnx",
    decoder_file_name: "sam-vit-h-quant.decoder.onnx",
    encoder_size_bytes: 656_832_738,
    encoder_crc32: 0xaa6ceee8,
    decoder_size_bytes: 8_742_607,
    decoder_crc32: 0x2a5d9f1d,
    input_width: 1024,
    input_height: 682,
}];

const CUTOUT_REFINER: RefinerSpec = RefinerSpec {
    id: "vitmatte-small-composition-1k",
    file_name: "cutout-refiner-vitmatte-small.onnx",
    size_bytes: 103_885_865,
    crc32: 0xa0a30d4f,
};

struct ImageEmbedding {
    id: u64,
    shape: Vec<i64>,
    data: Vec<f32>,
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
    box_coordinates: [f32; 4],
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

fn model_paths(app: &AppHandle, spec: ModelSpec) -> Result<(PathBuf, PathBuf), String> {
    let models_dir = models_directory(app)?;
    Ok((
        models_dir.join(spec.encoder_file_name),
        models_dir.join(spec.decoder_file_name),
    ))
}

fn refiner_path(app: &AppHandle, spec: RefinerSpec) -> Result<PathBuf, String> {
    Ok(models_directory(app)?.join(spec.file_name))
}

fn validate_model_file(
    path: &Path,
    expected_size: u64,
    expected_crc32: u32,
    label: &str,
    state: &CutoutState,
    epoch: u64,
) -> Result<(), String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|_| format!("{label} 文件不存在，请重新下载模型。"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("{label} 文件类型无效，请重新下载模型。"));
    }
    if metadata.len() != expected_size {
        return Err(format!("{label} 文件不完整，请移除后重新下载模型。"));
    }

    let file = File::open(path).map_err(|error| format!("无法读取 {label}：{error}"))?;
    let mut reader = BufReader::with_capacity(MODEL_READ_BUFFER_BYTES, file);
    let mut buffer = vec![0_u8; MODEL_READ_BUFFER_BYTES];
    let mut hasher = Hasher::new();
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
        .any(|input| input.name == "input_image");
    let has_output = session
        .outputs
        .iter()
        .any(|output| output.name == "image_embeddings");
    if has_input && has_output {
        Ok(())
    } else {
        Err("encoder 输入输出与当前抠图协议不兼容。".to_string())
    }
}

fn validate_decoder_contract(session: &Session) -> Result<(), String> {
    const REQUIRED_INPUTS: [&str; 6] = [
        "image_embeddings",
        "point_coords",
        "point_labels",
        "mask_input",
        "has_mask_input",
        "orig_im_size",
    ];
    let has_inputs = REQUIRED_INPUTS
        .iter()
        .all(|name| session.inputs.iter().any(|input| input.name == *name));
    let has_masks = session.outputs.iter().any(|output| output.name == "masks");
    let has_iou_predictions = session
        .outputs
        .iter()
        .any(|output| output.name == "iou_predictions");
    if has_inputs && has_masks && has_iou_predictions {
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
        if !value.is_finite() || !(0.0..=255.0).contains(&value) {
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
    let (encoder_path, decoder_path) = model_paths(app, spec)?;
    validate_model_file(
        &encoder_path,
        spec.encoder_size_bytes,
        spec.encoder_crc32,
        "encoder",
        &state,
        epoch,
    )?;
    validate_model_file(
        &decoder_path,
        spec.decoder_size_bytes,
        spec.decoder_crc32,
        "decoder",
        &state,
        epoch,
    )?;

    let mut encoder = create_session(&encoder_path, "encoder")?;
    validate_encoder_contract(&encoder)?;
    if state.is_cancelled(epoch) {
        return Err(cancelled_error());
    }

    let input_tensor = Tensor::from_array(([spec.input_height, spec.input_width, 3], input))
        .map_err(|error| format!("无法创建 encoder 输入：{error}"))?;
    let run_options = state.begin_run(epoch)?;
    let outputs = encoder.run_with_options(
        ort::inputs! { "input_image" => input_tensor },
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

    let embedding_value = outputs
        .get("image_embeddings")
        .ok_or_else(|| "encoder 未返回图像特征。".to_string())?;
    let (embedding_shape, embedding_data) = embedding_value
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("encoder 图像特征无效：{error}"))?;
    if **embedding_shape != EMBEDDING_SHAPE {
        return Err(format!("encoder 图像特征尺寸不兼容：{embedding_shape}。"));
    }
    let embedding_shape = embedding_shape.to_vec();
    let embedding_data = embedding_data.to_vec();
    drop(outputs);
    drop(encoder);

    let decoder = create_session(&decoder_path, "decoder")?;
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
            shape: embedding_shape,
            data: embedding_data,
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

fn mask_logit_to_alpha(logit: f32) -> u8 {
    let normalized = ((logit + MASK_LOGIT_TRANSITION_HALF_WIDTH)
        / (2.0 * MASK_LOGIT_TRANSITION_HALF_WIDTH))
        .clamp(0.0, 1.0);
    let smoothed = normalized * normalized * (3.0 - 2.0 * normalized);
    (smoothed * u8::MAX as f32).round() as u8
}

fn select_best_mask_alpha(
    mask_shape: &[i64],
    mask_data: &[f32],
    iou_predictions: &[f32],
    expected_width: usize,
    expected_height: usize,
) -> Result<Vec<u8>, String> {
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
    if mask_data.len() != expected_values {
        return Err("decoder 返回的遮罩数据不完整。".to_string());
    }
    if iou_predictions.len() != candidate_count {
        return Err("decoder 返回的遮罩评分数量不匹配。".to_string());
    }

    let mut best_candidate = 0_usize;
    let mut best_score = f32::NEG_INFINITY;
    for (candidate, score) in iou_predictions.iter().copied().enumerate() {
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

fn decode_box(app: &AppHandle, request: DecodeRequest) -> Result<Response, String> {
    let state = app.state::<CutoutState>();
    let epoch = state.cancel_epoch.load(Ordering::SeqCst);
    let requested_spec = find_model(&request.model_id)?;
    validate_box_coordinates(requested_spec, request.box_coordinates)?;
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
    let embedding_tensor =
        TensorRef::from_array_view((embedding.shape.as_slice(), embedding.data.as_slice()))
            .map_err(|error| format!("无法读取图像特征：{error}"))?;
    let [x1, y1, x2, y2] = request.box_coordinates;
    let point_coords = Tensor::from_array(([1_usize, 3, 2], vec![x1, y1, x2, y2, 0.0, 0.0]))
        .map_err(|error| format!("无法创建框选坐标：{error}"))?;
    let point_labels = Tensor::from_array(([1_usize, 3], vec![2.0_f32, 3.0, -1.0]))
        .map_err(|error| format!("无法创建框选标签：{error}"))?;
    let mask_input = Tensor::from_array(([1_usize, 1, 256, 256], vec![0.0_f32; 256 * 256]))
        .map_err(|error| format!("无法创建初始遮罩：{error}"))?;
    let has_mask_input = Tensor::from_array(([1_usize], vec![0.0_f32]))
        .map_err(|error| format!("无法创建遮罩状态：{error}"))?;
    let original_size = Tensor::from_array((
        [2_usize],
        vec![spec.input_height as f32, spec.input_width as f32],
    ))
    .map_err(|error| format!("无法创建图片尺寸：{error}"))?;

    let run_options = state.begin_run(epoch)?;
    let outputs = decoder.run_with_options(
        ort::inputs! {
            "image_embeddings" => embedding_tensor,
            "point_coords" => point_coords,
            "point_labels" => point_labels,
            "mask_input" => mask_input,
            "has_mask_input" => has_mask_input,
            "orig_im_size" => original_size
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
        .get("masks")
        .ok_or_else(|| "decoder 未返回分割遮罩。".to_string())?;
    let (mask_shape, mask_data) = masks
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("decoder 分割遮罩无效：{error}"))?;
    let iou_predictions = outputs
        .get("iou_predictions")
        .ok_or_else(|| "decoder 未返回遮罩评分。".to_string())?;
    let (_, iou_data) = iou_predictions
        .try_extract_tensor::<f32>()
        .map_err(|error| format!("decoder 遮罩评分无效：{error}"))?;
    let alpha_mask = select_best_mask_alpha(
        mask_shape,
        mask_data,
        iou_data,
        spec.input_width,
        spec.input_height,
    )?;
    Ok(Response::new(alpha_mask))
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
        validate_model_file(
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
    tauri::async_runtime::spawn_blocking(move || decode_box(&task_app, request))
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
    use super::{mask_logit_to_alpha, refiner_output_alpha, select_best_mask_alpha};

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
        let mask_shape = [1, 3, 2, 2];
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
        let error = select_best_mask_alpha(&[1, 2, 1, 1], &[0.0, 1.0], &[0.5], 1, 1)
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
