import { invoke } from "@tauri-apps/api/core";
import { cutoutSelectionBounds } from "@/services/cutoutGeometry";
import type {
  CutoutModelDescriptor,
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
  drawWidth: number;
  drawHeight: number;
  scale: number;
}

const isTauri = "__TAURI_INTERNALS__" in window;
const REFINER_MIN_LONG_EDGE = 512;
const REFINER_MAX_LONG_EDGE = 1024;
const REFINER_INPUT_MULTIPLE = 32;
const TRIMAP_FOREGROUND_THRESHOLD = 128;

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

/**
 * SAM encoder 接受 HWC RGB float32（0..255）。图片等比缩放后贴在
 * 固定预处理画布左上角，剩余区域填黑。
 */
function preprocessImage(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  inputWidth: number,
  inputHeight: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = inputWidth;
  canvas.height = inputHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法处理该图片。");

  const scale = Math.min(inputWidth / sourceWidth, inputHeight / sourceHeight);
  const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
  const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
  context.fillStyle = "#000000";
  context.fillRect(0, 0, inputWidth, inputHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, drawWidth, drawHeight);

  const rgba = context.getImageData(0, 0, inputWidth, inputHeight).data;
  const rgb = new Float32Array(inputWidth * inputHeight * 3);
  for (
    let sourceOffset = 0, targetOffset = 0;
    sourceOffset < rgba.length;
    sourceOffset += 4
  ) {
    rgb[targetOffset] = rgba[sourceOffset];
    rgb[targetOffset + 1] = rgba[sourceOffset + 1];
    rgb[targetOffset + 2] = rgba[sourceOffset + 2];
    targetOffset += 3;
  }
  return { rgb, scale, drawWidth, drawHeight };
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
  const { rgb, scale, drawWidth, drawHeight } = preprocessImage(
    image,
    imageWidth,
    imageHeight,
    descriptor.inputWidth,
    descriptor.inputHeight
  );
  if (signal?.aborted) throw abortError();

  const bytes = new Uint8Array(rgb.buffer, rgb.byteOffset, rgb.byteLength);
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
    drawWidth,
    drawHeight,
    scale
  };
}

function promptCoordinates(
  context: CutoutImageEmbedding,
  box: CutoutSelectionBox
): [number, number, number, number] {
  const x1 = clamp(box.x, 0, context.imageWidth - 1) * context.scale;
  const y1 = clamp(box.y, 0, context.imageHeight - 1) * context.scale;
  const x2 = clamp(box.x + box.width, 1, context.imageWidth) * context.scale;
  const y2 = clamp(box.y + box.height, 1, context.imageHeight) * context.scale;
  return [
    clamp(x1, 0, context.drawWidth),
    clamp(y1, 0, context.drawHeight),
    clamp(x2, 0, context.drawWidth),
    clamp(y2, 0, context.drawHeight)
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

interface InterpolationAxis {
  lower: Uint32Array;
  upper: Uint32Array;
  weight: Float32Array;
}

function createInterpolationAxis(
  targetSize: number,
  sourceSize: number,
  sourceOffset = 0
): InterpolationAxis {
  const lower = new Uint32Array(targetSize);
  const upper = new Uint32Array(targetSize);
  const weight = new Float32Array(targetSize);
  const scale = sourceSize / targetSize;

  for (let index = 0; index < targetSize; index += 1) {
    const sourceCoordinate = (index + 0.5) * scale - 0.5;
    const sourceLower = Math.floor(sourceCoordinate);
    lower[index] = sourceOffset + clamp(sourceLower, 0, sourceSize - 1);
    upper[index] = sourceOffset + clamp(sourceLower + 1, 0, sourceSize - 1);
    weight[index] = sourceCoordinate - sourceLower;
  }
  return { lower, upper, weight };
}

function resampleAlphaPlane(
  source: Uint8Array,
  sourceStride: number,
  targetWidth: number,
  targetHeight: number,
  horizontal: InterpolationAxis,
  vertical: InterpolationAxis
): Uint8Array {
  const target = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const topRow = vertical.lower[y] * sourceStride;
    const bottomRow = vertical.upper[y] * sourceStride;
    const verticalWeight = vertical.weight[y];
    const targetRow = y * targetWidth;
    for (let x = 0; x < targetWidth; x += 1) {
      const left = horizontal.lower[x];
      const right = horizontal.upper[x];
      const horizontalWeight = horizontal.weight[x];
      const top =
        source[topRow + left] +
        (source[topRow + right] - source[topRow + left]) * horizontalWeight;
      const bottom =
        source[bottomRow + left] +
        (source[bottomRow + right] - source[bottomRow + left]) * horizontalWeight;
      target[targetRow + x] = Math.round(
        top + (bottom - top) * verticalWeight
      );
    }
  }
  return target;
}

/** 将预处理画布大小的软 alpha 遮罩双线性映射回原图尺寸。 */
function restoreAlphaMask(mask: Uint8Array, context: CutoutImageEmbedding): Uint8Array {
  const planeSize = context.inputWidth * context.inputHeight;
  if (mask.byteLength !== planeSize) {
    throw new Error("原生 decoder 返回的遮罩尺寸无效。");
  }
  return resampleAlphaPlane(
    mask,
    context.inputWidth,
    context.imageWidth,
    context.imageHeight,
    createInterpolationAxis(context.imageWidth, context.drawWidth),
    createInterpolationAxis(context.imageHeight, context.drawHeight)
  );
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

function createTrimap(alpha: Uint8Array, width: number, height: number): Uint8Array {
  const foreground = new Uint8Array(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    foreground[index] = Number(alpha[index] >= TRIMAP_FOREGROUND_THRESHOLD);
  }
  const radius = clamp(Math.round(Math.max(width, height) / 128), 4, 8);
  const eroded = morphBinaryMask(foreground, width, height, radius, "erode");
  const dilated = morphBinaryMask(foreground, width, height, radius, "dilate");
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
    Math.round(Math.max(bounds.width, bounds.height) * 0.06),
    12,
    96
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
  return { input, inputWidth, inputHeight, drawWidth, drawHeight, trimap, bounds };
}

export async function refineCutoutMask(
  descriptor: CutoutRefinerDescriptor,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  alpha: Uint8Array,
  box: CutoutSelectionBox,
  signal?: AbortSignal
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

  const refinedCrop = resampleAlphaPlane(
    nativeAlpha,
    prepared.inputWidth,
    prepared.bounds.width,
    prepared.bounds.height,
    createInterpolationAxis(prepared.bounds.width, prepared.drawWidth),
    createInterpolationAxis(prepared.bounds.height, prepared.drawHeight)
  );
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
