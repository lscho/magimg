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
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius && !value; offset += 1) {
        const nextX = x + offset;
        if (nextX >= 0 && nextX < width && source[row + nextX] >= 32) value = 255;
      }
      horizontal[row + x] = value;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius && !value; offset += 1) {
        const nextY = y + offset;
        if (nextY >= 0 && nextY < height && horizontal[nextY * width + x]) value = 255;
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

export function prepareRepairMask(
  mask: Uint8Array,
  width: number,
  height: number,
  box?: CutoutSelectionBox
) {
  const radius = clamp(Math.round(Math.max(width, height) / 512), 2, 8);
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
