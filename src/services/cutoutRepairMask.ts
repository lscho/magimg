import { cutoutSelectionBounds } from "@/services/cutoutGeometry";
import {
  intersectMasks,
  maskArea,
  subtractMask,
  unionMasks
} from "@/services/cutoutLayering";
import type { CutoutMaskCandidate } from "@/services/cutoutInference";
import type {
  CutoutBrushPoint,
  CutoutRemovalStroke,
  CutoutSelectionBox
} from "@/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function sampleStrokePoints(
  stroke: CutoutRemovalStroke,
  maxPoints = 8
): CutoutBrushPoint[] {
  if (stroke.points.length <= maxPoints) return stroke.points.map((point) => ({ ...point }));
  return Array.from({ length: maxPoints }, (_, index) => {
    const sourceIndex = Math.round(index * (stroke.points.length - 1) / (maxPoints - 1));
    return { ...stroke.points[sourceIndex] };
  });
}

export function clipMaskToBox(
  mask: Uint8Array,
  width: number,
  height: number,
  box: CutoutSelectionBox
) {
  if (mask.length !== width * height) throw new Error("遮罩尺寸与图片不匹配。");
  const bounds = cutoutSelectionBounds(width, height, box);
  const output = new Uint8Array(mask.length);
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    const start = y * width + bounds.x;
    output.set(mask.subarray(start, start + bounds.width), start);
  }
  return output;
}

export function chooseSmartRemovalCandidate(
  candidates: readonly CutoutMaskCandidate[],
  points: readonly CutoutBrushPoint[],
  width: number,
  height: number,
  parent: CutoutSelectionBox
): Uint8Array | null {
  const parentArea = Math.max(1, parent.width * parent.height);
  return candidates
    .map((candidate) => ({
      ...candidate,
      alpha: clipMaskToBox(candidate.alpha, width, height, parent)
    }))
    .filter((candidate) => maskArea(candidate.alpha) / parentArea <= 0.8)
    .filter((candidate) => {
      if (!points.length) return false;
      const covered = points.filter((point) => {
        const x = clamp(Math.round(point.x), 0, width - 1);
        const y = clamp(Math.round(point.y), 0, height - 1);
        return candidate.alpha[y * width + x] >= 32;
      }).length;
      return covered / points.length >= 0.6;
    })
    .sort((a, b) => b.score - a.score)[0]?.alpha ?? null;
}

function paintDisk(
  target: Uint8Array,
  width: number,
  height: number,
  point: CutoutBrushPoint,
  radius: number,
  bounds: ReturnType<typeof cutoutSelectionBounds>
) {
  const left = Math.max(bounds.x, Math.floor(point.x - radius));
  const right = Math.min(bounds.x + bounds.width - 1, Math.ceil(point.x + radius));
  const top = Math.max(bounds.y, Math.floor(point.y - radius));
  const bottom = Math.min(bounds.y + bounds.height - 1, Math.ceil(point.y + radius));
  const radiusSquared = radius * radius;
  for (let y = top; y <= bottom && y < height; y += 1) {
    for (let x = left; x <= right && x < width; x += 1) {
      const dx = x + 0.5 - point.x;
      const dy = y + 0.5 - point.y;
      if (dx * dx + dy * dy <= radiusSquared) target[y * width + x] = 255;
    }
  }
}

function rasterizeStroke(
  target: Uint8Array,
  width: number,
  height: number,
  box: CutoutSelectionBox,
  stroke: CutoutRemovalStroke
) {
  const bounds = cutoutSelectionBounds(width, height, box);
  const radius = clamp(stroke.radius, 1, Math.max(width, height));
  if (stroke.points.length === 1) {
    paintDisk(target, width, height, stroke.points[0], radius, bounds);
    return;
  }
  for (let index = 1; index < stroke.points.length; index += 1) {
    const start = stroke.points[index - 1];
    const end = stroke.points[index];
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)));
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      paintDisk(target, width, height, {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio
      }, radius, bounds);
    }
  }
}

export function buildRemovalMask(options: {
  width: number;
  height: number;
  parent: CutoutSelectionBox;
  parentAlpha: Uint8Array;
  childAlphas: readonly Uint8Array[];
  strokes: readonly CutoutRemovalStroke[];
  smartMasks: ReadonlyMap<string, Uint8Array>;
}) {
  const { width, height, parent, parentAlpha, childAlphas, strokes, smartMasks } = options;
  const add = new Uint8Array(width * height);
  const restore = new Uint8Array(width * height);
  for (const stroke of strokes) {
    rasterizeStroke(
      stroke.operation === "restore" ? restore : add,
      width,
      height,
      parent,
      stroke
    );
  }
  const additions = [
    ...childAlphas,
    ...smartMasks.values(),
    add
  ].filter((mask) => mask.some((value) => value > 0));
  if (!additions.length) return new Uint8Array(width * height);
  const combined = unionMasks(additions);
  return intersectMasks(subtractMask(combined, restore), parentAlpha);
}

function binaryMask(source: Uint8Array, threshold: number) {
  const output = new Uint8Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] >= threshold) output[index] = 255;
  }
  return output;
}

function morphBinary(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number
) {
  if (radius <= 0) return source.slice();
  const horizontal = new Uint8Array(source.length);
  const output = new Uint8Array(source.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let count = 0;
    for (let x = 0; x <= radius && x < width; x += 1) {
      if (source[row + x] >= 32) count += 1;
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[row + x] = count > 0 ? 255 : 0;
      const leaving = x - radius;
      const entering = x + radius + 1;
      if (leaving >= 0 && source[row + leaving] >= 32) count -= 1;
      if (entering < width && source[row + entering] >= 32) count += 1;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y <= radius && y < height; y += 1) {
      if (horizontal[y * width + x]) count += 1;
    }
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = count > 0 ? 255 : 0;
      const leaving = y - radius;
      const entering = y + radius + 1;
      if (leaving >= 0 && horizontal[leaving * width + x]) count -= 1;
      if (entering < height && horizontal[entering * width + x]) count += 1;
    }
  }
  return output;
}

function highRecallChildRadius(child: CutoutSelectionBox) {
  return clamp(Math.round(Math.max(child.width, child.height) * 0.025), 4, 18);
}

export function highRecallChildMaskPadding(child: CutoutSelectionBox) {
  return highRecallChildRadius(child) * 3;
}

export function repairMaskRadius(width: number, height: number) {
  return clamp(Math.round(Math.max(width, height) / 512), 2, 8);
}

export function textRepairMaskRadius(box: CutoutSelectionBox) {
  return clamp(Math.round(Math.min(box.width, box.height) * 0.08), 2, 4);
}

/**
 * OCR 图层的透明 PNG 只覆盖可见字形。修复前在字形附近做小幅扩张，
 * 吸收描边和抗锯齿残留，但不把整块文字选框变成修复区域。
 */
export function expandTextRepairMask(
  mask: Uint8Array,
  width: number,
  height: number,
  box: CutoutSelectionBox
) {
  if (mask.length !== width * height) throw new Error("文字遮罩尺寸与图片不匹配。");
  return morphBinary(
    binaryMask(mask, 8),
    width,
    height,
    textRepairMaskRadius(box)
  );
}

/**
 * 背景移除优先保证召回率：保留精修 Alpha，并吸收其附近的 SAM 弱响应，
 * 再按子元素尺寸扩张。结果仍限制在子框附近，避免粗蒙版污染父级边框。
 */
export function buildHighRecallChildMask(options: {
  refinedAlpha: Uint8Array;
  coarseAlpha: Uint8Array;
  width: number;
  height: number;
  child: CutoutSelectionBox;
}) {
  const { refinedAlpha, coarseAlpha, width, height, child } = options;
  if (
    refinedAlpha.length !== width * height ||
    coarseAlpha.length !== width * height
  ) {
    throw new Error("子选区遮罩尺寸与图片不匹配。");
  }
  const radius = highRecallChildRadius(child);
  const refinedSeed = binaryMask(refinedAlpha, 8);
  const coarseSeed = binaryMask(coarseAlpha, 8);
  const nearby = morphBinary(refinedSeed, width, height, radius * 2);
  const combined = new Uint8Array(refinedSeed.length);
  let hasRefined = false;
  for (let index = 0; index < combined.length; index += 1) {
    hasRefined = hasRefined || refinedSeed[index] > 0;
    if (refinedSeed[index] || (nearby[index] && coarseSeed[index])) combined[index] = 255;
  }
  if (!hasRefined) combined.set(coarseSeed);

  const expanded = morphBinary(combined, width, height, radius);
  const padding = highRecallChildMaskPadding(child);
  const x = Math.max(0, child.x - padding);
  const y = Math.max(0, child.y - padding);
  const right = Math.min(width, child.x + child.width + padding);
  const bottom = Math.min(height, child.y + child.height + padding);
  return clipMaskToBox(expanded, width, height, {
    ...child,
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  });
}

export function prepareRepairMask(
  mask: Uint8Array,
  width: number,
  height: number,
  box?: CutoutSelectionBox
) {
  const radius = repairMaskRadius(width, height);
  const dilated = morphBinary(mask, width, height, radius);
  const horizontal = new Uint16Array(mask.length);
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x <= radius && x < width; x += 1) sum += dilated[row + x];
    for (let x = 0; x < width; x += 1) {
      const count = Math.min(width - 1, x + radius) - Math.max(0, x - radius) + 1;
      horizontal[row + x] = Math.round(sum / count);
      const leaving = x - radius;
      const entering = x + radius + 1;
      if (leaving >= 0) sum -= dilated[row + leaving];
      if (entering < width) sum += dilated[row + entering];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = 0; y <= radius && y < height; y += 1) {
      sum += horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      const count = Math.min(height - 1, y + radius) - Math.max(0, y - radius) + 1;
      const index = y * width + x;
      output[index] = Math.max(mask[index], Math.round(sum / count));
      const leaving = y - radius;
      const entering = y + radius + 1;
      if (leaving >= 0) sum -= horizontal[leaving * width + x];
      if (entering < height) sum += horizontal[entering * width + x];
    }
  }
  return box ? clipMaskToBox(output, width, height, box) : output;
}

export function maskContainment(child: Uint8Array, parent: Uint8Array) {
  const childArea = maskArea(child);
  if (childArea <= 0) return 0;
  return maskArea(intersectMasks(child, parent)) / childArea;
}
