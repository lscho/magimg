import { compositeMaskedRgba } from "@/services/cutoutRepairCompositing";
import type { CutoutSelectionBox } from "@/types";

const MAX_COLOR_SAMPLES = 100_000;
const MAX_MATCHED_CHANNEL_DIFFERENCE = 32;
const MIN_COLOR_SAMPLES = 256;
const CLOUD_FEATHER_RATIO = 0.12;
const CLOUD_MIN_FEATHER = 8;
const CLOUD_MAX_FEATHER = 24;

interface CloudCompositeGeometry {
  covered: Uint8Array;
  mask: Uint8Array;
}

interface ChannelMapping {
  scale: number;
  offset: number;
}

function clampedBounds(box: CutoutSelectionBox, width: number, height: number) {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(width, Math.ceil(box.x + box.width));
  const bottom = Math.min(height, Math.ceil(box.y + box.height));
  return { left, top, right, bottom };
}

function createAutoLayerCloudCompositeGeometry(
  width: number,
  height: number,
  boxes: readonly CutoutSelectionBox[]
): CloudCompositeGeometry {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("自动分层云背景尺寸无效。");
  }
  const covered = new Uint8Array(width * height);
  const featherWidths = new Uint8Array(width * height);
  for (const box of boxes) {
    const bounds = clampedBounds(box, width, height);
    const boxWidth = bounds.right - bounds.left;
    const boxHeight = bounds.bottom - bounds.top;
    if (boxWidth <= 0 || boxHeight <= 0) continue;
    const minimumEdge = Math.min(boxWidth, boxHeight);
    const feather = Math.min(
      CLOUD_MAX_FEATHER,
      Math.max(0, Math.min(
        Math.max(CLOUD_MIN_FEATHER, Math.round(minimumEdge * CLOUD_FEATHER_RATIO)),
        Math.floor((minimumEdge - 1) / 2)
      ))
    );
    for (let y = bounds.top; y < bounds.bottom; y += 1) {
      for (let x = bounds.left; x < bounds.right; x += 1) {
        const index = y * width + x;
        covered[index] = 1;
        if (feather > featherWidths[index]) featherWidths[index] = feather;
      }
    }
  }
  const distances = unionInteriorDistances(covered, width, height);
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    if (!covered[index]) continue;
    const feather = featherWidths[index];
    if (feather <= 0) {
      mask[index] = 255;
      continue;
    }
    const normalized = Math.min(1, Math.max(0, distances[index] - 1) / feather);
    mask[index] = Math.round(normalized * (2 - normalized) * 255);
  }
  return { covered, mask };
}

export function createAutoLayerCloudCompositeMask(
  width: number,
  height: number,
  boxes: readonly CutoutSelectionBox[]
) {
  return createAutoLayerCloudCompositeGeometry(width, height, boxes).mask;
}

function unionInteriorDistances(covered: Uint8Array, width: number, height: number) {
  const distances = new Uint16Array(covered.length);
  distances.fill(0xffff);
  for (let index = 0; index < covered.length; index += 1) {
    if (!covered[index]) distances[index] = 0;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!covered[index]) continue;
      let distance = distances[index];
      if (x > 0) distance = Math.min(distance, distances[index - 1] + 1);
      if (y > 0) {
        distance = Math.min(distance, distances[index - width] + 1);
        if (x > 0) distance = Math.min(distance, distances[index - width - 1] + 1);
        if (x + 1 < width) distance = Math.min(distance, distances[index - width + 1] + 1);
      }
      distances[index] = distance;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (!covered[index]) continue;
      let distance = distances[index];
      if (x + 1 < width) distance = Math.min(distance, distances[index + 1] + 1);
      if (y + 1 < height) {
        distance = Math.min(distance, distances[index + width] + 1);
        if (x > 0) distance = Math.min(distance, distances[index + width - 1] + 1);
        if (x + 1 < width) distance = Math.min(distance, distances[index + width + 1] + 1);
      }
      distances[index] = distance;
    }
  }
  return distances;
}

function fitChannelMapping(
  source: Uint8ClampedArray,
  repaired: Uint8ClampedArray,
  covered: Uint8Array,
  channel: number,
  sampleStride: number
): ChannelMapping {
  let scale = 1;
  let offset = 0;
  let residualLimit = Number.POSITIVE_INFINITY;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    let count = 0;
    let sourceTotal = 0;
    let repairedTotal = 0;
    let repairedSquaredTotal = 0;
    let pairedTotal = 0;
    const residualHistogram = new Uint32Array(256);
    for (let pixel = 0; pixel < covered.length; pixel += sampleStride) {
      if (covered[pixel]) continue;
      const pixelOffset = pixel * 4;
      let matched = true;
      for (let currentChannel = 0; currentChannel < 3; currentChannel += 1) {
        if (Math.abs(source[pixelOffset + currentChannel] - repaired[pixelOffset + currentChannel]) >
          MAX_MATCHED_CHANNEL_DIFFERENCE) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      const sourceValue = source[pixelOffset + channel];
      const repairedValue = repaired[pixelOffset + channel];
      const residual = Math.abs(sourceValue - (scale * repairedValue + offset));
      if (residual > residualLimit) continue;
      count += 1;
      sourceTotal += sourceValue;
      repairedTotal += repairedValue;
      repairedSquaredTotal += repairedValue * repairedValue;
      pairedTotal += repairedValue * sourceValue;
      residualHistogram[Math.min(255, Math.round(residual))] += 1;
    }
    if (count < MIN_COLOR_SAMPLES) return { scale: 1, offset: 0 };
    const denominator = count * repairedSquaredTotal - repairedTotal * repairedTotal;
    if (denominator <= count * 64) return { scale: 1, offset: 0 };
    scale = (count * pairedTotal - repairedTotal * sourceTotal) / denominator;
    offset = (sourceTotal - scale * repairedTotal) / count;
    if (!Number.isFinite(scale) || !Number.isFinite(offset) ||
      scale < 0.85 || scale > 1.15 || offset < -24 || offset > 24) {
      return { scale: 1, offset: 0 };
    }
    const target = Math.ceil(count * 0.8);
    let accumulated = 0;
    let quantile = 0;
    for (; quantile < residualHistogram.length; quantile += 1) {
      accumulated += residualHistogram[quantile];
      if (accumulated >= target) break;
    }
    residualLimit = Math.max(2, quantile);
  }
  return { scale, offset };
}

function matchGeneratedPageColors(
  source: Uint8ClampedArray,
  repaired: Uint8ClampedArray,
  covered: Uint8Array
) {
  const sampleStride = Math.max(1, Math.ceil(covered.length / MAX_COLOR_SAMPLES));
  const mappings = [0, 1, 2].map(channel => fitChannelMapping(
    source,
    repaired,
    covered,
    channel,
    sampleStride
  ));
  if (mappings.every(mapping =>
    Math.abs(mapping.scale - 1) < 0.002 && Math.abs(mapping.offset) < 0.5
  )) return repaired;
  const corrected = new Uint8ClampedArray(repaired);
  for (let pixel = 0; pixel < covered.length; pixel += 1) {
    if (!covered[pixel]) continue;
    const pixelOffset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const mapping = mappings[channel];
      corrected[pixelOffset + channel] = Math.round(
        repaired[pixelOffset + channel] * mapping.scale + mapping.offset
      );
    }
  }
  return corrected;
}

export function compositeAutoLayerCloudRgba(
  source: Uint8ClampedArray,
  repaired: Uint8ClampedArray,
  width: number,
  height: number,
  boxes: readonly CutoutSelectionBox[]
) {
  if (source.length !== repaired.length || source.length !== width * height * 4) {
    throw new Error("自动分层云背景合成数据尺寸不匹配。");
  }
  const geometry = createAutoLayerCloudCompositeGeometry(width, height, boxes);
  return compositeMaskedRgba(
    source,
    matchGeneratedPageColors(source, repaired, geometry.covered),
    geometry.mask
  );
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("自动分层云背景合成失败。")),
    "image/png"
  ));
}

export async function compositeAutoLayerCloudOutput(
  sourceBlob: Blob,
  repairedBlob: Blob,
  width: number,
  height: number,
  boxes: readonly CutoutSelectionBox[]
) {
  const [source, repaired] = await Promise.all([
    createImageBitmap(sourceBlob),
    createImageBitmap(repairedBlob)
  ]);
  try {
    if (source.width !== width || source.height !== height ||
      repaired.width !== width || repaired.height !== height) {
      throw new Error("云端背景尺寸与原图不一致。");
    }
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
    const repairedCanvas = document.createElement("canvas");
    repairedCanvas.width = width;
    repairedCanvas.height = height;
    const repairedContext = repairedCanvas.getContext("2d", { willReadFrequently: true });
    if (!sourceContext || !repairedContext) throw new Error("当前设备无法合成云端背景。");
    sourceContext.drawImage(source, 0, 0);
    repairedContext.drawImage(repaired, 0, 0);
    const sourcePixels = sourceContext.getImageData(0, 0, width, height);
    const repairedPixels = repairedContext.getImageData(0, 0, width, height);
    sourcePixels.data.set(compositeAutoLayerCloudRgba(
      sourcePixels.data,
      repairedPixels.data,
      width,
      height,
      boxes
    ));
    sourceContext.putImageData(sourcePixels, 0, 0);
    return canvasToPngBlob(sourceCanvas);
  } finally {
    source.close();
    repaired.close();
  }
}
