import { invoke } from "@tauri-apps/api/core";
import type { CutoutModelDescriptor, CutoutSelectionBox } from "@/types";

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

/** 将预处理画布大小的二值遮罩映射回原图尺寸。 */
function restoreMask(mask: Uint8Array, context: CutoutImageEmbedding): Uint8Array {
  const planeSize = context.inputWidth * context.inputHeight;
  if (mask.byteLength !== planeSize) {
    throw new Error("原生 decoder 返回的遮罩尺寸无效。");
  }
  const restored = new Uint8Array(context.imageWidth * context.imageHeight);

  for (let y = 0; y < context.imageHeight; y += 1) {
    const sourceY = Math.min(
      context.drawHeight - 1,
      Math.max(0, Math.floor((y + 0.5) * context.scale))
    );
    const sourceRow = sourceY * context.inputWidth;
    const targetRow = y * context.imageWidth;
    for (let x = 0; x < context.imageWidth; x += 1) {
      const sourceX = Math.min(
        context.drawWidth - 1,
        Math.max(0, Math.floor((x + 0.5) * context.scale))
      );
      restored[targetRow + x] = mask[sourceRow + sourceX] ? 1 : 0;
    }
  }
  return restored;
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
  return restoreMask(responseBytes(response), context);
}

export async function cancelInferenceRun(): Promise<void> {
  if (!isTauri) return;
  await invoke("cutout_cancel");
}

export async function releaseInferenceSession(modelId?: string): Promise<void> {
  if (!isTauri) return;
  await invoke("cutout_release", { modelId: modelId ?? null });
}
