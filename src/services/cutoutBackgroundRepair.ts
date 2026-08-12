import { invoke } from "@tauri-apps/api/core";
import { CUTOUT_REPAIR_MODEL } from "@/services/cutoutRepairModelManager";
import {
  compositeLocalRepairRgba,
  compositeMaskedRgba
} from "@/services/cutoutRepairCompositing";
import {
  buildCutoutRepairLayoutFromBounds,
  type CutoutRepairInputRect,
  type CutoutRepairLayout
} from "@/services/cutoutRepairLayout";
import {
  analyzeMaterialContext,
  alphaContentBounds,
  cropAlpha,
  fillRgbaOutsideAlpha,
  repairSmoothBackgroundRgba,
  type MaterialContextAnalysis
} from "@/services/cutoutRepairContext";
import { analyzeRepairBoundaryQuality } from "@/services/cutoutRepairSurface";
import {
  buildRepairTileAxis,
  MAX_REPAIR_TILES,
  repairTileAxisWeight,
  repairTileHasMask
} from "@/services/cutoutRepairTiling";
import type { CutoutSelectionBox } from "@/types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function abortError() {
  return new DOMException("背景修复已取消。", "AbortError");
}

function normalizeNativeError(exception: unknown) {
  if (exception instanceof Error) return exception;
  if (typeof exception === "string" && exception.trim()) return new Error(exception.trim());
  return new Error("原生背景修复失败，请稍后重试。");
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
  throw new Error("原生背景修复返回了无法识别的图片数据。");
}

function maskCropCanvas(
  mask: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  bounds: CutoutRepairLayout["bounds"]
) {
  if (mask.length !== imageWidth * imageHeight) {
    throw new Error("背景修复蒙版尺寸与图片不匹配。");
  }
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法准备背景修复蒙版。");
  const imageData = context.createImageData(bounds.width, bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceRow = (bounds.y + y) * imageWidth + bounds.x;
    const targetRow = y * bounds.width;
    for (let x = 0; x < bounds.width; x += 1) {
      const value = mask[sourceRow + x];
      const offset = (targetRow + x) * 4;
      imageData.data[offset] = value;
      imageData.data[offset + 1] = value;
      imageData.data[offset + 2] = value;
      imageData.data[offset + 3] = 255;
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

interface LocalRepairContext {
  canvas: HTMLCanvasElement;
  sourceRgba: Uint8ClampedArray;
  parentAlpha: Uint8Array;
  repairMask: Uint8Array;
  fillColor: readonly [number, number, number];
  analysis: MaterialContextAnalysis;
}

const MAX_DETERMINISTIC_BOUNDARY_ERROR = 14;
const MAX_DETERMINISTIC_STRONG_ERROR_RATIO = 0.12;

function prepareRepairContext(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  parentAlpha: Uint8Array,
  repairMask: Uint8Array,
  bounds: CutoutRepairLayout["bounds"]
): LocalRepairContext {
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法准备背景修复上下文。");
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
  const imageData = context.getImageData(0, 0, bounds.width, bounds.height);
  const croppedParentAlpha = cropAlpha(parentAlpha, imageWidth, imageHeight, bounds);
  const croppedRepairMask = cropAlpha(repairMask, imageWidth, imageHeight, bounds);
  const analysis = analyzeMaterialContext(
    imageData.data,
    croppedParentAlpha,
    croppedRepairMask,
    bounds.width,
    bounds.height
  );
  const filled = fillRgbaOutsideAlpha(
    imageData.data,
    croppedParentAlpha,
    bounds.width,
    bounds.height,
    analysis.fillColor
  );
  imageData.data.set(filled);
  context.putImageData(imageData, 0, 0);
  return {
    canvas,
    sourceRgba: imageData.data.slice(),
    parentAlpha: croppedParentAlpha,
    repairMask: croppedRepairMask,
    fillColor: analysis.fillColor,
    analysis
  };
}

/**
 * 用修复上下文中的 rect 区域构建 512×512 模型输入并调用 Big-LaMa，
 * 返回模型输出画布。rect 为修复上下文坐标，用于单次整框与分块两种路径。
 */
async function runRepairModel(
  repairContext: LocalRepairContext,
  bounds: CutoutRepairLayout["bounds"],
  rect: CutoutRepairInputRect,
  signal?: AbortSignal
): Promise<HTMLCanvasElement> {
  const { inputWidth, inputHeight } = CUTOUT_REPAIR_MODEL;
  const imageCanvas = document.createElement("canvas");
  imageCanvas.width = inputWidth;
  imageCanvas.height = inputHeight;
  const imageContext = imageCanvas.getContext("2d", { willReadFrequently: true });
  if (!imageContext) throw new Error("当前设备无法准备背景修复图片。");
  imageContext.imageSmoothingEnabled = true;
  imageContext.imageSmoothingQuality = "high";
  imageContext.fillStyle = `rgb(${repairContext.fillColor.join(", ")})`;
  imageContext.fillRect(0, 0, inputWidth, inputHeight);
  imageContext.drawImage(
    repairContext.canvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    inputWidth,
    inputHeight
  );

  const scaledMaskCanvas = document.createElement("canvas");
  scaledMaskCanvas.width = inputWidth;
  scaledMaskCanvas.height = inputHeight;
  const maskContext = scaledMaskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskContext) throw new Error("当前设备无法准备背景修复蒙版。");
  maskContext.imageSmoothingEnabled = false;
  maskContext.drawImage(
    maskCropCanvas(repairContext.repairMask, bounds.width, bounds.height, rect),
    0,
    0
  );

  const rgba = imageContext.getImageData(0, 0, inputWidth, inputHeight).data;
  const maskRgba = maskContext.getImageData(0, 0, inputWidth, inputHeight).data;
  const planeSize = inputWidth * inputHeight;
  const input = new Float32Array(planeSize * 4);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    const offset = pixel * 4;
    input[pixel] = rgba[offset] / 255;
    input[planeSize + pixel] = rgba[offset + 1] / 255;
    input[planeSize * 2 + pixel] = rgba[offset + 2] / 255;
    input[planeSize * 3 + pixel] = maskRgba[offset] >= 32 ? 1 : 0;
  }
  const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const handleAbort = () => { void invoke("cutout_cancel").catch(() => undefined); };
  signal?.addEventListener("abort", handleAbort, { once: true });
  let response: unknown;
  try {
    response = await invoke<ArrayBuffer>("cutout_repair", bytes, {
      headers: { "x-cutout-repair-id": CUTOUT_REPAIR_MODEL.id }
    });
  } catch (exception) {
    if (signal?.aborted) throw abortError();
    throw normalizeNativeError(exception);
  } finally {
    signal?.removeEventListener("abort", handleAbort);
  }
  if (signal?.aborted) throw abortError();
  return repairedModelCanvas(responseBytes(response));
}

function clampByte(value: number) {
  return Math.min(255, Math.max(0, value));
}

/** 单次整框修复：区域等比放入 512×512 输入，结果回放大到原尺寸。 */
async function repairBackgroundSingle(
  repairContext: LocalRepairContext,
  layout: CutoutRepairLayout,
  signal?: AbortSignal
): Promise<Uint8ClampedArray> {
  const { bounds, inputRect } = layout;
  const repaired = await runRepairModel(repairContext, bounds, inputRect, signal);
  const repairedCrop = document.createElement("canvas");
  repairedCrop.width = bounds.width;
  repairedCrop.height = bounds.height;
  const repairedContext = repairedCrop.getContext("2d", { willReadFrequently: true });
  if (!repairedContext) throw new Error("当前设备无法合成背景修复结果。");
  repairedContext.imageSmoothingEnabled = true;
  repairedContext.imageSmoothingQuality = "high";
  repairedContext.drawImage(
    repaired,
    inputRect.x,
    inputRect.y,
    inputRect.width,
    inputRect.height,
    0,
    0,
    bounds.width,
    bounds.height
  );
  return repairedContext.getImageData(0, 0, bounds.width, bounds.height).data;
}

/**
 * 分块修复：区域按 512×512 瓦片覆盖，只运行包含修复蒙版的瓦片，
 * 输出按轴分离的线性羽化权重合成。无蒙版瓦片沿用原图；
 * 超出模型调用预算时返回 null，由调用方回退为整框单次修复。
 */
async function repairBackgroundTiled(
  repairContext: LocalRepairContext,
  bounds: CutoutRepairLayout["bounds"],
  signal?: AbortSignal
): Promise<Uint8ClampedArray | null> {
  const { inputWidth, inputHeight } = CUTOUT_REPAIR_MODEL;
  const width = bounds.width;
  const height = bounds.height;
  const xAxis = buildRepairTileAxis(width, inputWidth);
  const yAxis = buildRepairTileAxis(height, inputHeight);

  const activeTiles: Array<{ col: number; row: number; x: number; y: number }> = [];
  for (let row = 0; row < yAxis.count; row += 1) {
    for (let col = 0; col < xAxis.count; col += 1) {
      const x = xAxis.starts[col];
      const y = yAxis.starts[row];
      if (!repairTileHasMask(
        repairContext.repairMask,
        width,
        height,
        x,
        y,
        inputWidth,
        inputHeight
      )) continue;
      activeTiles.push({ col, row, x, y });
    }
  }
  if (!activeTiles.length) return repairContext.sourceRgba.slice();
  if (activeTiles.length > MAX_REPAIR_TILES) return null;

  const diff = new Float32Array(width * height * 3);
  for (let index = 0; index < activeTiles.length; index += 1) {
    if (signal?.aborted) throw abortError();
    const tile = activeTiles[index];
    const repaired = await runRepairModel(
      repairContext,
      bounds,
      { x: tile.x, y: tile.y, width: inputWidth, height: inputHeight },
      signal
    );
    const repairedContext = repaired.getContext("2d", { willReadFrequently: true });
    if (!repairedContext) throw new Error("当前设备无法读取背景修复结果。");
    const repairedPixels = repairedContext.getImageData(0, 0, inputWidth, inputHeight).data;
    const weightX = new Float32Array(inputWidth);
    const weightY = new Float32Array(inputHeight);
    for (let dx = 0; dx < inputWidth; dx += 1) {
      weightX[dx] = repairTileAxisWeight(tile.col, xAxis.starts, inputWidth, tile.x + dx);
    }
    for (let dy = 0; dy < inputHeight; dy += 1) {
      weightY[dy] = repairTileAxisWeight(tile.row, yAxis.starts, inputHeight, tile.y + dy);
    }
    for (let dy = 0; dy < inputHeight; dy += 1) {
      const weightYValue = weightY[dy];
      if (weightYValue <= 0) continue;
      const sourceRow = (tile.y + dy) * width + tile.x;
      const modelRow = dy * inputWidth;
      for (let dx = 0; dx < inputWidth; dx += 1) {
        const weight = weightX[dx] * weightYValue;
        if (weight <= 0) continue;
        const sourceIndex = sourceRow + dx;
        const sourceOffset = sourceIndex * 4;
        const modelOffset = (modelRow + dx) * 4;
        const targetOffset = sourceIndex * 3;
        diff[targetOffset] +=
          (repairedPixels[modelOffset] - repairContext.sourceRgba[sourceOffset]) * weight;
        diff[targetOffset + 1] +=
          (repairedPixels[modelOffset + 1] - repairContext.sourceRgba[sourceOffset + 1]) * weight;
        diff[targetOffset + 2] +=
          (repairedPixels[modelOffset + 2] - repairContext.sourceRgba[sourceOffset + 2]) * weight;
      }
    }
  }

  const output = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const sourceOffset = pixel * 4;
    const targetOffset = pixel * 3;
    output[sourceOffset] = clampByte(Math.round(
      repairContext.sourceRgba[sourceOffset] + diff[targetOffset]
    ));
    output[sourceOffset + 1] = clampByte(Math.round(
      repairContext.sourceRgba[sourceOffset + 1] + diff[targetOffset + 1]
    ));
    output[sourceOffset + 2] = clampByte(Math.round(
      repairContext.sourceRgba[sourceOffset + 2] + diff[targetOffset + 2]
    ));
    output[sourceOffset + 3] = 255;
  }
  return output;
}

async function repairBackgroundWithModel(
  repairContext: LocalRepairContext,
  layout: CutoutRepairLayout,
  signal?: AbortSignal
) {
  const { bounds } = layout;
  const { inputWidth, inputHeight } = CUTOUT_REPAIR_MODEL;
  const needsTiling = bounds.width > inputWidth || bounds.height > inputHeight;
  // 只在下采样超过约 10% 时分块；轻微超尺寸仍走单次整框，避免无谓的多次调用。
  const downscaleSignificant = Math.min(inputWidth / bounds.width, inputHeight / bounds.height) < 0.9;
  if (needsTiling && downscaleSignificant) {
    return (await repairBackgroundTiled(repairContext, bounds, signal))
      ?? await repairBackgroundSingle(repairContext, layout, signal);
  }
  return repairBackgroundSingle(repairContext, layout, signal);
}

function repairQualityScore(
  repairContext: LocalRepairContext,
  repaired: Uint8ClampedArray,
  width: number,
  height: number
) {
  const quality = analyzeRepairBoundaryQuality(
    repairContext.sourceRgba,
    repaired,
    repairContext.parentAlpha,
    repairContext.repairMask,
    width,
    height
  );
  return {
    ...quality,
    score: quality.meanError + quality.strongErrorRatio * 24
  };
}

function deterministicRepairNeedsModelFallback(
  quality: ReturnType<typeof repairQualityScore>
) {
  if (quality.sampleCount < 8) return true;
  return quality.meanError > MAX_DETERMINISTIC_BOUNDARY_ERROR ||
    quality.strongErrorRatio > MAX_DETERMINISTIC_STRONG_ERROR_RATIO;
}

function repairedModelCanvas(bytes: Uint8Array) {
  const { inputWidth, inputHeight } = CUTOUT_REPAIR_MODEL;
  const planeSize = inputWidth * inputHeight;
  if (bytes.length !== planeSize * 3) {
    throw new Error("背景修复模型返回的图片尺寸无效。");
  }
  const canvas = document.createElement("canvas");
  canvas.width = inputWidth;
  canvas.height = inputHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法合成背景修复结果。");
  const imageData = context.createImageData(inputWidth, inputHeight);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    const offset = pixel * 4;
    imageData.data[offset] = bytes[pixel];
    imageData.data[offset + 1] = bytes[planeSize + pixel];
    imageData.data[offset + 2] = bytes[planeSize * 2 + pixel];
    imageData.data[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export async function repairBackgroundLocally(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  repairMask: Uint8Array,
  parentAlpha: Uint8Array,
  box: CutoutSelectionBox,
  options: {
    signal?: AbortSignal;
    forceDiffusion?: boolean;
  } = {}
) {
  const { signal, forceDiffusion = false } = options;
  if (!isTauri) throw new Error("浏览器预览不能运行本地背景修复模型。");
  if (signal?.aborted) throw abortError();
  const layout = buildCutoutRepairLayoutFromBounds(
    alphaContentBounds(parentAlpha, imageWidth, imageHeight, box),
    CUTOUT_REPAIR_MODEL.inputWidth,
    CUTOUT_REPAIR_MODEL.inputHeight
  );
  const { bounds } = layout;
  const repairContext = prepareRepairContext(
    image,
    imageWidth,
    imageHeight,
    parentAlpha,
    repairMask,
    bounds
  );
  let repairedPixels: Uint8ClampedArray;
  const deterministic = forceDiffusion || repairContext.analysis.repairStrategy !== "model";
  if (deterministic) {
    repairedPixels = repairSmoothBackgroundRgba(
      repairContext.sourceRgba,
      repairContext.parentAlpha,
      repairContext.repairMask,
      bounds.width,
      bounds.height,
      repairContext.fillColor
    );
    // 高置信曲面直接采用；较复杂的确定性候选若接缝异常，则运行 Big-LaMa 并择优。
    if (!forceDiffusion && repairContext.analysis.repairStrategy === "diffusion") {
      const deterministicQuality = repairQualityScore(
        repairContext,
        repairedPixels,
        bounds.width,
        bounds.height
      );
      if (deterministicRepairNeedsModelFallback(deterministicQuality)) {
        const modelPixels = await repairBackgroundWithModel(repairContext, layout, signal);
        const modelQuality = repairQualityScore(
          repairContext,
          modelPixels,
          bounds.width,
          bounds.height
        );
        if (modelQuality.score < deterministicQuality.score) repairedPixels = modelPixels;
      }
    }
  } else {
    repairedPixels = await repairBackgroundWithModel(repairContext, layout, signal);
  }
  if (signal?.aborted) throw abortError();

  const output = document.createElement("canvas");
  output.width = imageWidth;
  output.height = imageHeight;
  const context = output.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法合成背景修复结果。");
  context.drawImage(image, 0, 0, imageWidth, imageHeight);
  const sourcePixels = context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
  sourcePixels.data.set(compositeLocalRepairRgba(
    sourcePixels.data,
    repairedPixels,
    repairContext.repairMask
  ));
  context.putImageData(sourcePixels, bounds.x, bounds.y);
  return output;
}

export async function maskToPngBlob(mask: Uint8Array, width: number, height: number) {
  if (mask.length !== width * height) throw new Error("云端修复蒙版尺寸无效。");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成云端修复蒙版。");
  const imageData = context.createImageData(width, height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    imageData.data[offset] = mask[pixel];
    imageData.data[offset + 1] = mask[pixel];
    imageData.data[offset + 2] = mask[pixel];
    imageData.data[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("云端修复蒙版生成失败。")), "image/png");
  });
}

export async function imageBlobSource(blob: Blob) {
  return createImageBitmap(blob);
}

export function compositeRepairedImage(
  source: CanvasImageSource,
  repaired: CanvasImageSource,
  mask: Uint8Array,
  width: number,
  height: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法合成云端修复结果。");
  context.drawImage(source, 0, 0, width, height);
  const sourcePixels = context.getImageData(0, 0, width, height);
  const repairedCanvas = document.createElement("canvas");
  repairedCanvas.width = width;
  repairedCanvas.height = height;
  const repairedContext = repairedCanvas.getContext("2d", { willReadFrequently: true });
  if (!repairedContext) throw new Error("当前设备无法读取云端修复结果。");
  repairedContext.drawImage(repaired, 0, 0, width, height);
  const repairedPixels = repairedContext.getImageData(0, 0, width, height).data;
  sourcePixels.data.set(compositeMaskedRgba(sourcePixels.data, repairedPixels, mask));
  context.putImageData(sourcePixels, 0, 0);
  return canvas;
}
