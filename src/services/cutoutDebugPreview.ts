/**
 * AI 抠图调试页面的中间结果可视化工具。
 * 只在开发模式的 /debug/cutout 使用：把链路中的 Uint8Array 蒙版、Alpha 与
 * 修复画布渲染成可直接展示的缩略预览，并给出面积、覆盖率等定量指标。
 * 所有渲染都先按最近邻下采样到预览尺寸，避免整图 ImageData 占用大量内存。
 */

/** 预览图最长边，超过则等比缩小。 */
export const DEBUG_PREVIEW_MAX_EDGE = 560;
/** 判定为“被覆盖”的 Alpha 阈值，与修复链路的默认阈值保持一致。 */
export const DEBUG_MASK_THRESHOLD = 16;

export interface CutoutMaskStats {
  /** Alpha >= DEBUG_MASK_THRESHOLD 的像素数量。 */
  area: number;
  /** 覆盖率，0..1。 */
  coverage: number;
  /** 半透明像素数量（1..254），可用于判断边缘是否过硬。 */
  softArea: number;
  maxValue: number;
}

export interface CutoutMaskDiff {
  /** 仅前一步覆盖（被后一步收缩掉）的像素数。 */
  onlyBefore: number;
  /** 仅后一步覆盖（被后一步补出来）的像素数。 */
  onlyAfter: number;
  shared: number;
  /** 交并比，1 表示两步结果完全一致。 */
  iou: number;
}

export interface PreviewSize {
  width: number;
  height: number;
  scale: number;
}

export function maskStats(mask: Uint8Array): CutoutMaskStats {
  let area = 0;
  let softArea = 0;
  let maxValue = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const value = mask[index];
    if (value >= DEBUG_MASK_THRESHOLD) area += 1;
    if (value > 0 && value < 255) softArea += 1;
    if (value > maxValue) maxValue = value;
  }
  return {
    area,
    coverage: mask.length ? area / mask.length : 0,
    softArea,
    maxValue
  };
}

export function maskDiff(before: Uint8Array, after: Uint8Array): CutoutMaskDiff {
  if (before.length !== after.length) {
    throw new Error("对比的两个蒙版尺寸不一致。");
  }
  let onlyBefore = 0;
  let onlyAfter = 0;
  let shared = 0;
  for (let index = 0; index < before.length; index += 1) {
    const a = before[index] >= DEBUG_MASK_THRESHOLD;
    const b = after[index] >= DEBUG_MASK_THRESHOLD;
    if (a && b) shared += 1;
    else if (a) onlyBefore += 1;
    else if (b) onlyAfter += 1;
  }
  const union = shared + onlyBefore + onlyAfter;
  return { onlyBefore, onlyAfter, shared, iou: union ? shared / union : 1 };
}

export function previewSize(
  width: number,
  height: number,
  maxEdge = DEBUG_PREVIEW_MAX_EDGE
): PreviewSize {
  const longEdge = Math.max(width, height);
  if (longEdge <= 0) return { width: 1, height: 1, scale: 1 };
  const scale = Math.min(1, maxEdge / longEdge);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale
  };
}

/** 最近邻下采样：把全分辨率平面数据映射到预览尺寸。 */
export function samplePlane(
  plane: Uint8Array,
  width: number,
  height: number,
  target: PreviewSize
): Uint8Array {
  if (plane.length !== width * height) {
    throw new Error("预览采样的平面数据尺寸与图片不匹配。");
  }
  const output = new Uint8Array(target.width * target.height);
  for (let y = 0; y < target.height; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y + 0.5) / target.height * height));
    const sourceRow = sourceY * width;
    const targetRow = y * target.width;
    for (let x = 0; x < target.width; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x + 0.5) / target.width * width));
      output[targetRow + x] = plane[sourceRow + sourceX];
    }
  }
  return output;
}

function createContext(size: PreviewSize) {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法渲染调试预览。");
  return { canvas, context };
}

function canvasToObjectUrl(canvas: HTMLCanvasElement) {
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(URL.createObjectURL(blob))
        : reject(new Error("调试预览生成失败。")),
      "image/png"
    );
  });
}

function drawScaledImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  size: PreviewSize
) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, size.width, size.height);
}

function drawCheckerboard(context: CanvasRenderingContext2D, size: PreviewSize) {
  const cell = 12;
  for (let y = 0; y < size.height; y += cell) {
    for (let x = 0; x < size.width; x += cell) {
      const even = ((x / cell) | 0) % 2 === ((y / cell) | 0) % 2;
      context.fillStyle = even ? "#2a3240" : "#222933";
      context.fillRect(x, y, cell, cell);
    }
  }
}

/** 原图缩略预览。 */
export async function renderImagePreview(
  image: CanvasImageSource,
  width: number,
  height: number,
  maxEdge = DEBUG_PREVIEW_MAX_EDGE
) {
  const size = previewSize(width, height, maxEdge);
  const { canvas, context } = createContext(size);
  drawScaledImage(context, image, size);
  return canvasToObjectUrl(canvas);
}

/** 灰度蒙版预览：黑=0，白=255。 */
export async function renderMaskPreview(
  mask: Uint8Array,
  width: number,
  height: number,
  maxEdge = DEBUG_PREVIEW_MAX_EDGE
) {
  const size = previewSize(width, height, maxEdge);
  const sampled = samplePlane(mask, width, height, size);
  const { canvas, context } = createContext(size);
  const imageData = context.createImageData(size.width, size.height);
  for (let pixel = 0; pixel < sampled.length; pixel += 1) {
    const offset = pixel * 4;
    imageData.data[offset] = sampled[pixel];
    imageData.data[offset + 1] = sampled[pixel];
    imageData.data[offset + 2] = sampled[pixel];
    imageData.data[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvasToObjectUrl(canvas);
}

/** Trimap 预览：0=黑（确定背景），128=蓝（未知带），255=白（确定前景）。 */
export async function renderTrimapPreview(
  trimap: Uint8Array,
  width: number,
  height: number,
  maxEdge = DEBUG_PREVIEW_MAX_EDGE
) {
  const size = previewSize(width, height, maxEdge);
  const sampled = samplePlane(trimap, width, height, size);
  const { canvas, context } = createContext(size);
  const imageData = context.createImageData(size.width, size.height);
  for (let pixel = 0; pixel < sampled.length; pixel += 1) {
    const offset = pixel * 4;
    const value = sampled[pixel];
    const foreground = value >= 255;
    const background = value <= 0;
    imageData.data[offset] = foreground ? 255 : background ? 12 : 56;
    imageData.data[offset + 1] = foreground ? 255 : background ? 16 : 132;
    imageData.data[offset + 2] = foreground ? 255 : background ? 22 : 232;
    imageData.data[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvasToObjectUrl(canvas);
}

/** 原图叠加彩色蒙版，便于确认覆盖位置是否正确。 */
export async function renderOverlayPreview(
  image: CanvasImageSource,
  mask: Uint8Array,
  width: number,
  height: number,
  color: readonly number[] = [88, 196, 255],
  maxEdge = DEBUG_PREVIEW_MAX_EDGE
) {
  const size = previewSize(width, height, maxEdge);
  const sampled = samplePlane(mask, width, height, size);
  const { canvas, context } = createContext(size);
  drawScaledImage(context, image, size);
  const imageData = context.getImageData(0, 0, size.width, size.height);
  for (let pixel = 0; pixel < sampled.length; pixel += 1) {
    const strength = sampled[pixel] / 255 * 0.55;
    if (strength <= 0) continue;
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      imageData.data[offset + channel] = Math.round(
        imageData.data[offset + channel] * (1 - strength) + color[channel] * strength
      );
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvasToObjectUrl(canvas);
}

/** 前后蒙版差异：红色为被收缩掉的像素，绿色为新补出的像素。 */
export async function renderMaskDiffPreview(
  before: Uint8Array,
  after: Uint8Array,
  width: number,
  height: number,
  maxEdge = DEBUG_PREVIEW_MAX_EDGE
) {
  if (before.length !== after.length) {
    throw new Error("对比的两个蒙版尺寸不一致。");
  }
  const size = previewSize(width, height, maxEdge);
  const sampledBefore = samplePlane(before, width, height, size);
  const sampledAfter = samplePlane(after, width, height, size);
  const { canvas, context } = createContext(size);
  const imageData = context.createImageData(size.width, size.height);
  for (let pixel = 0; pixel < sampledBefore.length; pixel += 1) {
    const a = sampledBefore[pixel] >= DEBUG_MASK_THRESHOLD;
    const b = sampledAfter[pixel] >= DEBUG_MASK_THRESHOLD;
    const offset = pixel * 4;
    imageData.data[offset + 3] = 255;
    if (a && b) {
      imageData.data[offset] = 78;
      imageData.data[offset + 1] = 82;
      imageData.data[offset + 2] = 92;
    } else if (a) {
      imageData.data[offset] = 232;
      imageData.data[offset + 1] = 84;
      imageData.data[offset + 2] = 88;
    } else if (b) {
      imageData.data[offset] = 92;
      imageData.data[offset + 1] = 216;
      imageData.data[offset + 2] = 140;
    } else {
      imageData.data[offset] = 16;
      imageData.data[offset + 1] = 20;
      imageData.data[offset + 2] = 26;
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvasToObjectUrl(canvas);
}

/** 棋盘底 + Alpha 合成，模拟最终透明素材的观感。 */
export async function renderAlphaCompositePreview(
  image: CanvasImageSource,
  mask: Uint8Array,
  width: number,
  height: number,
  maxEdge = DEBUG_PREVIEW_MAX_EDGE
) {
  const size = previewSize(width, height, maxEdge);
  const sampled = samplePlane(mask, width, height, size);
  const layer = createContext(size);
  drawScaledImage(layer.context, image, size);
  const layerData = layer.context.getImageData(0, 0, size.width, size.height);
  for (let pixel = 0; pixel < sampled.length; pixel += 1) {
    const offset = pixel * 4 + 3;
    layerData.data[offset] = Math.round(layerData.data[offset] * sampled[pixel] / 255);
  }
  layer.context.putImageData(layerData, 0, 0);

  const { canvas, context } = createContext(size);
  drawCheckerboard(context, size);
  context.drawImage(layer.canvas, 0, 0);
  return canvasToObjectUrl(canvas);
}

/** 直接从 Blob 生成预览地址，调用方负责释放。 */
export function blobPreviewUrl(blob: Blob) {
  return URL.createObjectURL(blob);
}

export function formatPercent(value: number, fractionDigits = 2) {
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

export function formatDuration(milliseconds: number) {
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(2)} s`
    : `${Math.round(milliseconds)} ms`;
}
