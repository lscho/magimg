import { invoke } from "@tauri-apps/api/core";
import { cutoutSelectionBounds, type CutoutPixelBounds } from "@/services/cutoutGeometry";
import {
  createInterpolationAxis,
  guidedUpsampleAlpha,
  resampleAlphaPlane
} from "@/services/cutoutResample";
import type {
  CutoutModelDescriptor,
  CutoutPointPrompt,
  CutoutRefinerDescriptor,
  CutoutSelectionBox
} from "@/types";

interface NativeEncodeResponse {
  embeddingId: string;
}

export interface CutoutImageEmbedding {
  modelId: string;
  embeddingId: string;
  imageWidth: number;
  imageHeight: number;
  inputWidth: number;
  inputHeight: number;
  maskWidth: number;
  maskHeight: number;
  scaleX: number;
  scaleY: number;
}

const isTauri = "__TAURI_INTERNALS__" in window;
const MAX_POINT_PROMPTS = 16;
const SAM2_IMAGE_MEAN = [0.485, 0.456, 0.406] as const;
const SAM2_IMAGE_STD = [0.229, 0.224, 0.225] as const;
const REFINER_MIN_LONG_EDGE = 512;
const REFINER_MAX_LONG_EDGE = 1024;
const REFINER_INPUT_MULTIPLE = 32;
const TRIMAP_FOREGROUND_THRESHOLD = 128;
const TRIMAP_DETAIL_THRESHOLD = 32;

function abortError() {
  return new DOMException("抠图已取消。", "AbortError");
}

function ensureNativeRuntime() {
  if (!isTauri) {
    throw new Error("浏览器预览不能运行本地模型，请在桌面客户端中使用。");
  }
}

function normalizeNativeError(exception: unknown, fallback: string): Error {
  if (exception instanceof Error) return exception;
  if (typeof exception === "string" && exception.trim()) {
    return new Error(exception);
  }
  return new Error(fallback);
}

async function invokeWithCancellation<T>(
  start: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) throw abortError();
  const handleAbort = () => {
    void invoke("cutout_cancel").catch(() => undefined);
  };
  signal?.addEventListener("abort", handleAbort, { once: true });
  try {
    const result = await start();
    if (signal?.aborted) throw abortError();
    return result;
  } catch (exception) {
    if (signal?.aborted) throw abortError();
    throw exception;
  } finally {
    signal?.removeEventListener("abort", handleAbort);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** SAM 2.1 encoder 接受按 ImageNet 均值方差归一化的 NCHW RGB。 */
function preprocessImage(
  source: CanvasImageSource,
  inputWidth: number,
  inputHeight: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = inputWidth;
  canvas.height = inputHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法处理该图片。");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, inputWidth, inputHeight);

  const rgba = context.getImageData(0, 0, inputWidth, inputHeight).data;
  const planeSize = inputWidth * inputHeight;
  const input = new Float32Array(planeSize * 3);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    const sourceOffset = pixel * 4;
    input[pixel] = (rgba[sourceOffset] / 255 - SAM2_IMAGE_MEAN[0]) / SAM2_IMAGE_STD[0];
    input[planeSize + pixel] =
      (rgba[sourceOffset + 1] / 255 - SAM2_IMAGE_MEAN[1]) / SAM2_IMAGE_STD[1];
    input[planeSize * 2 + pixel] =
      (rgba[sourceOffset + 2] / 255 - SAM2_IMAGE_MEAN[2]) / SAM2_IMAGE_STD[2];
  }
  return input;
}

export async function encodeCutoutImage(
  descriptor: CutoutModelDescriptor,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  signal?: AbortSignal
): Promise<CutoutImageEmbedding> {
  ensureNativeRuntime();
  if (signal?.aborted) throw abortError();
  const input = preprocessImage(
    image,
    descriptor.inputWidth,
    descriptor.inputHeight
  );
  if (signal?.aborted) throw abortError();

  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let response: NativeEncodeResponse;
  try {
    response = await invokeWithCancellation(
      () =>
        invoke<NativeEncodeResponse>("cutout_encode", bytes, {
          headers: { "x-cutout-model-id": descriptor.id }
        }),
      signal
    );
  } catch (exception) {
    if (signal?.aborted) throw abortError();
    throw normalizeNativeError(exception, "原生 encoder 推理失败。");
  }

  return {
    modelId: descriptor.id,
    embeddingId: response.embeddingId,
    imageWidth,
    imageHeight,
    inputWidth: descriptor.inputWidth,
    inputHeight: descriptor.inputHeight,
    maskWidth: descriptor.maskWidth,
    maskHeight: descriptor.maskHeight,
    scaleX: descriptor.inputWidth / imageWidth,
    scaleY: descriptor.inputHeight / imageHeight
  };
}

function promptCoordinates(
  context: CutoutImageEmbedding,
  box: CutoutSelectionBox
): [number, number, number, number] {
  const x1 = clamp(box.x, 0, context.imageWidth - 1) * context.scaleX;
  const y1 = clamp(box.y, 0, context.imageHeight - 1) * context.scaleY;
  const x2 = clamp(box.x + box.width, 1, context.imageWidth) * context.scaleX;
  const y2 = clamp(box.y + box.height, 1, context.imageHeight) * context.scaleY;
  return [
    clamp(x1, 0, context.inputWidth),
    clamp(y1, 0, context.inputHeight),
    clamp(x2, 0, context.inputWidth),
    clamp(y2, 0, context.inputHeight)
  ];
}

function responseBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return Uint8Array.from(value as number[]);
  }
  throw new Error("原生 decoder 返回了无法识别的遮罩数据。");
}

/** 将 SAM 2.1 的低分辨率 logits alpha 双线性映射回原图尺寸。 */
function restoreAlphaMask(mask: Uint8Array, context: CutoutImageEmbedding): Uint8Array {
  const planeSize = context.maskWidth * context.maskHeight;
  if (mask.byteLength !== planeSize) {
    throw new Error("原生 decoder 返回的遮罩尺寸无效。");
  }
  return resampleAlphaPlane(
    mask,
    context.maskWidth,
    context.imageWidth,
    context.imageHeight,
    createInterpolationAxis(context.imageWidth, context.maskWidth),
    createInterpolationAxis(context.imageHeight, context.maskHeight)
  );
}

/** 一次点选/框选 decode 的提示组合，至少提供一种。 */
export interface CutoutDecodePrompt {
  box?: CutoutSelectionBox;
  points?: CutoutPointPrompt[];
}

/** decoder 单个候选遮罩：alpha 已映射回原图尺寸。 */
export interface CutoutMaskCandidate {
  /** decoder 预估的 IoU 评分，越高越可信。 */
  score: number;
  alpha: Uint8Array;
}

function promptPointInputs(context: CutoutImageEmbedding, points: CutoutPointPrompt[]) {
  const pointCoordinates: [number, number][] = [];
  const pointLabels: number[] = [];
  for (const point of points) {
    pointCoordinates.push([
      clamp(point.x * context.scaleX, 0, context.inputWidth),
      clamp(point.y * context.scaleY, 0, context.inputHeight)
    ]);
    pointLabels.push(point.label);
  }
  return { pointCoordinates, pointLabels };
}

/** 解析多候选响应：[候选数 u8][每候选 IoU f32 LE][每候选 alpha 平面 u8]。 */
function parseCandidateResponse(
  bytes: Uint8Array,
  context: CutoutImageEmbedding
): CutoutMaskCandidate[] {
  if (!bytes.byteLength) {
    throw new Error("原生 decoder 返回了无法识别的候选遮罩数据。");
  }
  const count = bytes[0];
  const planeSize = context.maskWidth * context.maskHeight;
  const scoresOffset = 1;
  const planesOffset = scoresOffset + count * 4;
  if (!count || bytes.byteLength !== planesOffset + count * planeSize) {
    throw new Error("原生 decoder 返回了无法识别的候选遮罩数据。");
  }

  const scores = new DataView(bytes.buffer, bytes.byteOffset + scoresOffset, count * 4);
  const candidates: CutoutMaskCandidate[] = [];
  for (let index = 0; index < count; index += 1) {
    const planeStart = planesOffset + index * planeSize;
    candidates.push({
      score: scores.getFloat32(index * 4, true),
      alpha: restoreAlphaMask(bytes.subarray(planeStart, planeStart + planeSize), context)
    });
  }
  return candidates;
}

/**
 * 点选/框选组合 decode，返回全部粒度候选（SAM 多粒度输出，通常 3 个）。
 * 用于分层抠图：同一位置的候选分别对应「子部件 / 部件 / 整体」。
 */
export async function decodeCutoutCandidates(
  descriptor: CutoutModelDescriptor,
  context: CutoutImageEmbedding,
  prompt: CutoutDecodePrompt,
  signal?: AbortSignal
): Promise<CutoutMaskCandidate[]> {
  ensureNativeRuntime();
  if (context.modelId !== descriptor.id) {
    throw new Error("图片特征与当前模型不匹配，请重新执行抠图。");
  }
  const points = prompt.points ?? [];
  if (!prompt.box && !points.length) {
    throw new Error("请先提供框选或点选提示。");
  }
  if (points.length > MAX_POINT_PROMPTS) {
    throw new Error("点选提示数量超出限制。");
  }
  if (signal?.aborted) throw abortError();

  const { pointCoordinates, pointLabels } = promptPointInputs(context, points);
  let response: unknown;
  try {
    response = await invokeWithCancellation(
      () =>
        invoke<ArrayBuffer>("cutout_decode", {
          request: {
            modelId: descriptor.id,
            embeddingId: context.embeddingId,
            boxCoordinates: prompt.box ? promptCoordinates(context, prompt.box) : null,
            pointCoordinates,
            pointLabels,
            returnCandidates: true
          }
        }),
      signal
    );
  } catch (exception) {
    if (signal?.aborted) throw abortError();
    throw normalizeNativeError(exception, "原生 decoder 推理失败。");
  }
  return parseCandidateResponse(responseBytes(response), context);
}

export async function decodeCutoutBox(
  descriptor: CutoutModelDescriptor,
  context: CutoutImageEmbedding,
  box: CutoutSelectionBox,
  signal?: AbortSignal
): Promise<Uint8Array> {
  ensureNativeRuntime();
  if (context.modelId !== descriptor.id) {
    throw new Error("图片特征与当前模型不匹配，请重新执行抠图。");
  }
  if (signal?.aborted) throw abortError();

  let response: unknown;
  try {
    response = await invokeWithCancellation(
      () =>
        invoke<ArrayBuffer>("cutout_decode", {
          request: {
            modelId: descriptor.id,
            embeddingId: context.embeddingId,
            boxCoordinates: promptCoordinates(context, box)
          }
        }),
      signal
    );
  } catch (exception) {
    if (signal?.aborted) throw abortError();
    throw normalizeNativeError(exception, "原生 decoder 推理失败。");
  }
  return restoreAlphaMask(responseBytes(response), context);
}

/**
 * BiRefNet Swin-T 单次前向分割：把选区 bbox（带上下文外扩）裁剪并缩放到
 * 1024x1024，推理后把 1024x1024 alpha 缩回 bbox 尺寸并映射回原图坐标。
 * 返回全分辨率（imageWidth x imageHeight）alpha。替代 SAM encoder+decoder。
 */
export async function segmentBirefnetBox(
  descriptor: CutoutModelDescriptor,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  box: CutoutSelectionBox,
  signal?: AbortSignal
): Promise<Uint8Array> {
  ensureNativeRuntime();
  if (signal?.aborted) throw abortError();
  const bounds = expandRefinerBounds(
    cutoutSelectionBounds(imageWidth, imageHeight, box),
    imageWidth,
    imageHeight
  );

  const canvas = document.createElement("canvas");
  canvas.width = descriptor.inputWidth;
  canvas.height = descriptor.inputHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法准备抠图分割输入。");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    descriptor.inputWidth,
    descriptor.inputHeight
  );
  const rgba = context.getImageData(0, 0, descriptor.inputWidth, descriptor.inputHeight).data;
  const planeSize = descriptor.inputWidth * descriptor.inputHeight;
  const input = new Float32Array(planeSize * 3);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    const sourceOffset = pixel * 4;
    input[pixel] = (rgba[sourceOffset] / 255 - SAM2_IMAGE_MEAN[0]) / SAM2_IMAGE_STD[0];
    input[planeSize + pixel] =
      (rgba[sourceOffset + 1] / 255 - SAM2_IMAGE_MEAN[1]) / SAM2_IMAGE_STD[1];
    input[planeSize * 2 + pixel] =
      (rgba[sourceOffset + 2] / 255 - SAM2_IMAGE_MEAN[2]) / SAM2_IMAGE_STD[2];
  }
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  let response: unknown;
  try {
    response = await invokeWithCancellation(
      () =>
        invoke<ArrayBuffer>("cutout_birefnet_segment", bytes, {
          headers: { "x-cutout-segmenter-id": descriptor.id }
        }),
      signal
    );
  } catch (exception) {
    if (signal?.aborted) throw abortError();
    throw normalizeNativeError(exception, "原生抠图分割推理失败。");
  }
  const mask1024 = responseBytes(response);
  if (mask1024.byteLength !== descriptor.maskWidth * descriptor.maskHeight) {
    throw new Error("原生抠图分割模型返回的遮罩尺寸无效。");
  }
  const scaled = resampleAlphaPlane(
    mask1024,
    descriptor.maskWidth,
    bounds.width,
    bounds.height,
    createInterpolationAxis(bounds.width, descriptor.maskWidth),
    createInterpolationAxis(bounds.height, descriptor.maskHeight)
  );
  const fullMask = new Uint8Array(imageWidth * imageHeight);
  for (let y = 0; y < bounds.height; y += 1) {
    const targetRow = (bounds.y + y) * imageWidth + bounds.x;
    fullMask.set(scaled.subarray(y * bounds.width, (y + 1) * bounds.width), targetRow);
  }
  return fullMask;
}

function morphBinaryMask(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  operation: "dilate" | "erode"
): Uint8Array {
  const diameter = radius * 2 + 1;
  const horizontal = new Uint8Array(source.length);
  const output = new Uint8Array(source.length);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x <= radius && x < width; x += 1) count += source[row + x];
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = operation === "dilate"
        ? Number(count > 0)
        : Number(count === diameter);
      const leaving = x - radius;
      const entering = x + radius + 1;
      if (leaving >= 0) count -= source[row + leaving];
      if (entering < width) count += source[row + entering];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y <= radius && y < height; y += 1) {
      count += horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = operation === "dilate"
        ? Number(count > 0)
        : Number(count === diameter);
      const leaving = y - radius;
      const entering = y + radius + 1;
      if (leaving >= 0) count -= horizontal[leaving * width + x];
      if (entering < height) count += horizontal[entering * width + x];
    }
  }
  return output;
}

/** 标记与裁剪区域边界连通的确定背景，封闭的内部缺口留给精修模型判断。 */
function markExteriorBackground(
  dilatedForeground: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const exterior = new Uint8Array(dilatedForeground.length);
  const queue = new Uint32Array(dilatedForeground.length);
  let head = 0;
  let tail = 0;

  const enqueue = (index: number) => {
    if (dilatedForeground[index] || exterior[index]) return;
    exterior[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  return exterior;
}

/**
 * 未知带非对称：发丝、毛边向背景侧延伸，膨胀半径要远大于腐蚀半径；
 * 膨胀种子用更低阈值，让 SAM 对细节的弱响应也能进入未知带交给精修模型。
 */
function createTrimap(alpha: Uint8Array, width: number, height: number): Uint8Array {
  const solidForeground = new Uint8Array(alpha.length);
  const faintForeground = new Uint8Array(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    solidForeground[index] = Number(alpha[index] >= TRIMAP_FOREGROUND_THRESHOLD);
    faintForeground[index] = Number(alpha[index] >= TRIMAP_DETAIL_THRESHOLD);
  }
  const longEdge = Math.max(width, height);
  const erodeRadius = clamp(Math.round(longEdge / 128), 4, 8);
  const dilateRadius = clamp(Math.round(longEdge / 32), 12, 32);
  const eroded = morphBinaryMask(solidForeground, width, height, erodeRadius, "erode");
  const dilated = morphBinaryMask(faintForeground, width, height, dilateRadius, "dilate");
  const exteriorBackground = markExteriorBackground(dilated, width, height);
  const trimap = new Uint8Array(alpha.length);
  for (let index = 0; index < trimap.length; index += 1) {
    trimap[index] = eroded[index] ? 255 : exteriorBackground[index] ? 0 : 128;
  }
  return trimap;
}

function expandRefinerBounds(
  bounds: ReturnType<typeof cutoutSelectionBounds>,
  imageWidth: number,
  imageHeight: number
) {
  const padding = clamp(
    Math.round(Math.max(bounds.width, bounds.height) * 0.08),
    16,
    128
  );
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const right = Math.min(imageWidth, bounds.x + bounds.width + padding);
  const bottom = Math.min(imageHeight, bounds.y + bounds.height + padding);
  return { x, y, width: right - x, height: bottom - y };
}

interface RefinerInput {
  input: Float32Array;
  inputWidth: number;
  inputHeight: number;
  drawWidth: number;
  drawHeight: number;
  trimap: Uint8Array;
  rgba: Uint8ClampedArray;
  bounds: ReturnType<typeof cutoutSelectionBounds>;
}

function prepareRefinerInput(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  alpha: Uint8Array,
  box: CutoutSelectionBox
): RefinerInput {
  if (alpha.byteLength !== imageWidth * imageHeight) {
    throw new Error("遮罩尺寸与图片不匹配，无法执行细节精修。");
  }
  const bounds = expandRefinerBounds(
    cutoutSelectionBounds(imageWidth, imageHeight, box),
    imageWidth,
    imageHeight
  );
  const longEdge = Math.max(bounds.width, bounds.height);
  const targetLongEdge = clamp(
    longEdge,
    REFINER_MIN_LONG_EDGE,
    REFINER_MAX_LONG_EDGE
  );
  const scale = targetLongEdge / longEdge;
  const drawWidth = Math.max(1, Math.round(bounds.width * scale));
  const drawHeight = Math.max(1, Math.round(bounds.height * scale));
  const inputWidth = Math.ceil(drawWidth / REFINER_INPUT_MULTIPLE) * REFINER_INPUT_MULTIPLE;
  const inputHeight = Math.ceil(drawHeight / REFINER_INPUT_MULTIPLE) * REFINER_INPUT_MULTIPLE;

  const canvas = document.createElement("canvas");
  canvas.width = drawWidth;
  canvas.height = drawHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法准备细节精修输入。");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    drawWidth,
    drawHeight
  );
  const rgba = context.getImageData(0, 0, drawWidth, drawHeight).data;
  const scaledAlpha = resampleAlphaPlane(
    alpha,
    imageWidth,
    drawWidth,
    drawHeight,
    createInterpolationAxis(drawWidth, bounds.width, bounds.x),
    createInterpolationAxis(drawHeight, bounds.height, bounds.y)
  );
  const trimap = createTrimap(scaledAlpha, drawWidth, drawHeight);
  const planeSize = inputWidth * inputHeight;
  const input = new Float32Array(planeSize * 4);
  for (let y = 0; y < drawHeight; y += 1) {
    const sourceRow = y * drawWidth;
    const targetRow = y * inputWidth;
    for (let x = 0; x < drawWidth; x += 1) {
      const sourceOffset = (sourceRow + x) * 4;
      const targetOffset = targetRow + x;
      input[targetOffset] = rgba[sourceOffset] / 127.5 - 1;
      input[planeSize + targetOffset] = rgba[sourceOffset + 1] / 127.5 - 1;
      input[planeSize * 2 + targetOffset] = rgba[sourceOffset + 2] / 127.5 - 1;
      input[planeSize * 3 + targetOffset] = trimap[sourceRow + x] / 255;
    }
  }
  return { input, inputWidth, inputHeight, drawWidth, drawHeight, trimap, rgba, bounds };
}

/** 按原分辨率读取图片指定区域的 RGBA，用作导向滤波的引导图。 */
function readImageRegion(
  image: CanvasImageSource,
  bounds: ReturnType<typeof cutoutSelectionBounds>
): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法准备细节精修输入。");
  context.drawImage(
    image,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );
  return context.getImageData(0, 0, bounds.width, bounds.height).data;
}

/**
 * 精修阶段的输入快照，仅供开发模式的调试页面观察 trimap 与实际输入尺寸。
 * 生产链路不传 onDebug，不会产生任何额外拷贝。
 */
export interface CutoutRefineDebugSnapshot {
  /** ViTMatte 输入的 trimap（trimapWidth x trimapHeight）：0 背景、128 未知带、255 前景。 */
  trimap: Uint8Array;
  trimapWidth: number;
  trimapHeight: number;
  /** 对齐到 32 倍数后的模型输入尺寸。 */
  inputWidth: number;
  inputHeight: number;
  /** 精修裁剪区域（原图坐标系）。 */
  bounds: CutoutPixelBounds;
  /** 是否需要导向上采样回原分辨率。 */
  guidedUpsample: boolean;
}

export async function refineCutoutMask(
  descriptor: CutoutRefinerDescriptor,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  alpha: Uint8Array,
  box: CutoutSelectionBox,
  signal?: AbortSignal,
  onDebug?: (snapshot: CutoutRefineDebugSnapshot) => void
): Promise<Uint8Array> {
  ensureNativeRuntime();
  if (signal?.aborted) throw abortError();
  const prepared = prepareRefinerInput(
    image,
    imageWidth,
    imageHeight,
    alpha,
    box
  );
  const needsGuidedUpsample =
    prepared.bounds.width > prepared.drawWidth ||
    prepared.bounds.height > prepared.drawHeight;
  onDebug?.({
    trimap: prepared.trimap.slice(),
    trimapWidth: prepared.drawWidth,
    trimapHeight: prepared.drawHeight,
    inputWidth: prepared.inputWidth,
    inputHeight: prepared.inputHeight,
    bounds: prepared.bounds,
    guidedUpsample: needsGuidedUpsample
  });
  if (signal?.aborted) throw abortError();
  const bytes = new Uint8Array(
    prepared.input.buffer,
    prepared.input.byteOffset,
    prepared.input.byteLength
  );

  let response: unknown;
  try {
    response = await invokeWithCancellation(
      () =>
        invoke<ArrayBuffer>("cutout_refine", bytes, {
          headers: {
            "x-cutout-refiner-id": descriptor.id,
            "x-cutout-refiner-width": String(prepared.inputWidth),
            "x-cutout-refiner-height": String(prepared.inputHeight)
          }
        }),
      signal
    );
  } catch (exception) {
    if (signal?.aborted) throw abortError();
    throw normalizeNativeError(exception, "原生细节精修失败。");
  }

  const nativeAlpha = responseBytes(response);
  if (nativeAlpha.byteLength !== prepared.inputWidth * prepared.inputHeight) {
    throw new Error("原生精修模型返回的 alpha 尺寸无效。");
  }
  for (let y = 0; y < prepared.drawHeight; y += 1) {
    const trimapRow = y * prepared.drawWidth;
    const alphaRow = y * prepared.inputWidth;
    for (let x = 0; x < prepared.drawWidth; x += 1) {
      const trimapValue = prepared.trimap[trimapRow + x];
      if (trimapValue === 255) nativeAlpha[alphaRow + x] = 255;
      else if (trimapValue === 0) nativeAlpha[alphaRow + x] = 0;
    }
  }

  let refinedCrop: Uint8Array;
  if (needsGuidedUpsample) {
    const packedAlpha = new Uint8Array(prepared.drawWidth * prepared.drawHeight);
    for (let y = 0; y < prepared.drawHeight; y += 1) {
      const sourceRow = y * prepared.inputWidth;
      packedAlpha.set(
        nativeAlpha.subarray(sourceRow, sourceRow + prepared.drawWidth),
        y * prepared.drawWidth
      );
    }
    refinedCrop = guidedUpsampleAlpha({
      lowRgba: prepared.rgba,
      lowAlpha: packedAlpha,
      lowWidth: prepared.drawWidth,
      lowHeight: prepared.drawHeight,
      highRgba: readImageRegion(image, prepared.bounds),
      highWidth: prepared.bounds.width,
      highHeight: prepared.bounds.height
    });
  } else {
    refinedCrop = resampleAlphaPlane(
      nativeAlpha,
      prepared.inputWidth,
      prepared.bounds.width,
      prepared.bounds.height,
      createInterpolationAxis(prepared.bounds.width, prepared.drawWidth),
      createInterpolationAxis(prepared.bounds.height, prepared.drawHeight)
    );
  }
  const refined = new Uint8Array(imageWidth * imageHeight);
  for (let y = 0; y < prepared.bounds.height; y += 1) {
    const sourceRow = y * prepared.bounds.width;
    const targetRow = (prepared.bounds.y + y) * imageWidth + prepared.bounds.x;
    refined.set(
      refinedCrop.subarray(sourceRow, sourceRow + prepared.bounds.width),
      targetRow
    );
  }
  return refined;
}

export async function cancelInferenceRun(): Promise<void> {
  if (!isTauri) return;
  await invoke("cutout_cancel");
}

export async function releaseInferenceSession(modelId?: string): Promise<void> {
  if (!isTauri) return;
  await invoke("cutout_release", { modelId: modelId ?? null });
}
