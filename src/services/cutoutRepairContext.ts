import { cutoutSelectionBounds, type CutoutPixelBounds } from "@/services/cutoutGeometry";
import type { CutoutSelection, CutoutSelectionBox } from "@/types";

const DEFAULT_ALPHA_THRESHOLD = 16;

export function alphaContentBounds(
  alpha: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  box: CutoutSelectionBox,
  threshold = DEFAULT_ALPHA_THRESHOLD
): CutoutPixelBounds {
  if (alpha.length !== imageWidth * imageHeight) {
    throw new Error("背景素材 Alpha 尺寸与图片不匹配。");
  }
  const selection = cutoutSelectionBounds(imageWidth, imageHeight, box);
  let left = selection.x + selection.width;
  let top = selection.y + selection.height;
  let right = selection.x - 1;
  let bottom = selection.y - 1;
  for (let y = selection.y; y < selection.y + selection.height; y += 1) {
    const row = y * imageWidth;
    for (let x = selection.x; x < selection.x + selection.width; x += 1) {
      if (alpha[row + x] < threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return selection;
  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1
  };
}

export function cropAlpha(
  alpha: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  bounds: CutoutPixelBounds
) {
  if (alpha.length !== imageWidth * imageHeight) {
    throw new Error("背景素材 Alpha 尺寸与图片不匹配。");
  }
  const output = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceRow = (bounds.y + y) * imageWidth + bounds.x;
    const targetRow = y * bounds.width;
    output.set(alpha.subarray(sourceRow, sourceRow + bounds.width), targetRow);
  }
  return output;
}

export interface MaterialContextAnalysis {
  fillColor: [number, number, number];
  dominantCoverage: number;
  nearbyCoverage: number;
  useDiffusion: boolean;
}

/** 纯手动添加笔画与命令行脚本保持一致，固定使用确定性扩散。 */
export function shouldForceManualDiffusion(
  selection: CutoutSelection,
  hasDirectChildren: boolean
) {
  if (hasDirectChildren) return false;
  const additions = selection.removalStrokes.filter((stroke) => stroke.operation === "add");
  return additions.length > 0 && additions.every((stroke) => !stroke.smart);
}

function assertContextDimensions(
  rgba: Uint8ClampedArray,
  alpha: Uint8Array,
  repairMask: Uint8Array,
  width: number,
  height: number
) {
  if (
    rgba.length !== width * height * 4 ||
    alpha.length !== width * height ||
    repairMask.length !== width * height
  ) {
    throw new Error("背景修复上下文尺寸不匹配。");
  }
}

export function analyzeMaterialContext(
  rgba: Uint8ClampedArray,
  alpha: Uint8Array,
  repairMask: Uint8Array,
  width: number,
  height: number,
  threshold = DEFAULT_ALPHA_THRESHOLD
): MaterialContextAnalysis {
  assertContextDimensions(rgba, alpha, repairMask, width, height);
  let maskLeft = width;
  let maskTop = height;
  let maskRight = -1;
  let maskBottom = -1;
  for (let pixel = 0; pixel < repairMask.length; pixel += 1) {
    if (repairMask[pixel] <= 0) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    maskLeft = Math.min(maskLeft, x);
    maskTop = Math.min(maskTop, y);
    maskRight = Math.max(maskRight, x);
    maskBottom = Math.max(maskBottom, y);
  }
  const sampleRadius = Math.min(32, Math.max(3, Math.round(Math.max(width, height) / 32)));
  let sampleLeft = maskRight >= 0 ? Math.max(0, maskLeft - sampleRadius) : 0;
  let sampleTop = maskBottom >= 0 ? Math.max(0, maskTop - sampleRadius) : 0;
  let sampleRight = maskRight >= 0 ? Math.min(width - 1, maskRight + sampleRadius) : width - 1;
  let sampleBottom = maskBottom >= 0 ? Math.min(height - 1, maskBottom + sampleRadius) : height - 1;

  const countSamples = () => {
    let count = 0;
    for (let y = sampleTop; y <= sampleBottom; y += 1) {
      for (let x = sampleLeft; x <= sampleRight; x += 1) {
        const pixel = y * width + x;
        if (alpha[pixel] >= threshold && repairMask[pixel] <= 0) count += 1;
      }
    }
    return count;
  };
  if (countSamples() < 16) {
    sampleLeft = 0;
    sampleTop = 0;
    sampleRight = width - 1;
    sampleBottom = height - 1;
  }

  const counts = new Uint32Array(4096);
  const red = new Float64Array(4096);
  const green = new Float64Array(4096);
  const blue = new Float64Array(4096);
  let total = 0;
  for (let y = sampleTop; y <= sampleBottom; y += 1) {
    for (let x = sampleLeft; x <= sampleRight; x += 1) {
      const pixel = y * width + x;
      if (alpha[pixel] < threshold || repairMask[pixel] > 0) continue;
      const offset = pixel * 4;
      const bin = (rgba[offset] >> 4) * 256 +
        (rgba[offset + 1] >> 4) * 16 +
        (rgba[offset + 2] >> 4);
      counts[bin] += 1;
      red[bin] += rgba[offset];
      green[bin] += rgba[offset + 1];
      blue[bin] += rgba[offset + 2];
      total += 1;
    }
  }
  if (!total) {
    return {
      fillColor: [127, 127, 127],
      dominantCoverage: 0,
      nearbyCoverage: 0,
      useDiffusion: false
    };
  }
  let dominantBin = 0;
  for (let bin = 1; bin < counts.length; bin += 1) {
    if (counts[bin] > counts[dominantBin]) dominantBin = bin;
  }
  const dominantCount = counts[dominantBin];
  const fillColor: [number, number, number] = [
    Math.round(red[dominantBin] / dominantCount),
    Math.round(green[dominantBin] / dominantCount),
    Math.round(blue[dominantBin] / dominantCount)
  ];
  let nearby = 0;
  for (let y = sampleTop; y <= sampleBottom; y += 1) {
    for (let x = sampleLeft; x <= sampleRight; x += 1) {
      const pixel = y * width + x;
      if (alpha[pixel] < threshold || repairMask[pixel] > 0) continue;
      const offset = pixel * 4;
      if (
        Math.abs(rgba[offset] - fillColor[0]) <= 36 &&
        Math.abs(rgba[offset + 1] - fillColor[1]) <= 36 &&
        Math.abs(rgba[offset + 2] - fillColor[2]) <= 36
      ) nearby += 1;
    }
  }
  const dominantCoverage = dominantCount / total;
  const nearbyCoverage = nearby / total;
  return {
    fillColor,
    dominantCoverage,
    nearbyCoverage,
    useDiffusion: total >= 16 && (
      nearbyCoverage >= 0.5 ||
      (nearbyCoverage >= 0.4 && dominantCoverage >= 0.2)
    )
  };
}

/** Alpha 外矩形余量使用素材主背景色，不再把边框拉伸成条纹。 */
export function fillRgbaOutsideAlpha(
  rgba: Uint8ClampedArray,
  alpha: Uint8Array,
  width: number,
  height: number,
  fillColor: readonly [number, number, number],
  threshold = DEFAULT_ALPHA_THRESHOLD
) {
  if (rgba.length !== width * height * 4 || alpha.length !== width * height) {
    throw new Error("背景修复上下文尺寸不匹配。");
  }
  const output = rgba.slice();
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    if (alpha[pixel] >= threshold) continue;
    const offset = pixel * 4;
    output[offset] = fillColor[0];
    output[offset + 1] = fillColor[1];
    output[offset + 2] = fillColor[2];
    output[offset + 3] = 255;
  }
  return output;
}

/** 对纯色或缓渐变 UI 背景做离散调和扩散，避免生成模型臆造纹理。 */
export function diffuseRepairRgba(
  rgba: Uint8ClampedArray,
  alpha: Uint8Array,
  repairMask: Uint8Array,
  width: number,
  height: number,
  fillColor: readonly [number, number, number],
  threshold = DEFAULT_ALPHA_THRESHOLD
) {
  assertContextDimensions(rgba, alpha, repairMask, width, height);
  const output = rgba.slice();
  const red = new Float32Array(alpha.length);
  const green = new Float32Array(alpha.length);
  const blue = new Float32Array(alpha.length);
  const unknownPixels = new Uint8Array(alpha.length);
  const reliableKnownPixels = new Uint8Array(alpha.length);
  const unknown: number[] = [];
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    const offset = pixel * 4;
    const needsRepair = alpha[pixel] >= threshold && repairMask[pixel] > 0;
    red[pixel] = needsRepair ? fillColor[0] : rgba[offset];
    green[pixel] = needsRepair ? fillColor[1] : rgba[offset + 1];
    blue[pixel] = needsRepair ? fillColor[2] : rgba[offset + 2];
    if (needsRepair) {
      unknownPixels[pixel] = 1;
      unknown.push(pixel);
    } else if (
      alpha[pixel] >= threshold &&
      Math.abs(rgba[offset] - fillColor[0]) <= 48 &&
      Math.abs(rgba[offset + 1] - fillColor[1]) <= 48 &&
      Math.abs(rgba[offset + 2] - fillColor[2]) <= 48
    ) {
      reliableKnownPixels[pixel] = 1;
    }
  }
  if (!unknown.length) return output;
  const sizeIterations = Math.min(320, Math.max(80, Math.round(Math.max(width, height) * 0.75)));
  const workLimitedIterations = Math.max(12, Math.floor(12_000_000 / unknown.length));
  const iterations = Math.min(sizeIterations, workLimitedIterations);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const reverse = iteration % 2 === 1;
    for (let item = 0; item < unknown.length; item += 1) {
      const unknownIndex = reverse ? unknown.length - item - 1 : item;
      const pixel = unknown[unknownIndex];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      let count = 0;
      const neighbors = [
        x > 0 ? pixel - 1 : -1,
        x + 1 < width ? pixel + 1 : -1,
        y > 0 ? pixel - width : -1,
        y + 1 < height ? pixel + width : -1
      ];
      for (const neighbor of neighbors) {
        if (
          neighbor < 0 ||
          (!unknownPixels[neighbor] && !reliableKnownPixels[neighbor])
        ) continue;
        redSum += red[neighbor];
        greenSum += green[neighbor];
        blueSum += blue[neighbor];
        count += 1;
      }
      if (!count) continue;
      red[pixel] = redSum / count;
      green[pixel] = greenSum / count;
      blue[pixel] = blueSum / count;
    }
  }
  for (const pixel of unknown) {
    const offset = pixel * 4;
    output[offset] = Math.round(red[pixel]);
    output[offset + 1] = Math.round(green[pixel]);
    output[offset + 2] = Math.round(blue[pixel]);
  }
  return output;
}
