import type { CutoutBrushPoint, CutoutSelection } from "@/types";

const POLYGON_VERTICAL_SAMPLES = 4;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function pointInCutoutPolygon(
  point: CutoutBrushPoint,
  polygon: readonly CutoutBrushPoint[]
) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const a = polygon[current];
    const b = polygon[previous];
    const crossesRay = (a.y > point.y) !== (b.y > point.y) &&
      point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crossesRay) inside = !inside;
  }
  return inside;
}

export function cutoutPolygonBounds(points: readonly CutoutBrushPoint[]) {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

/** Rasterizes the user-authored outline as an antialiased model-output constraint. */
export function rasterizeCutoutPolygon(
  imageWidth: number,
  imageHeight: number,
  polygon: readonly CutoutBrushPoint[]
) {
  const mask = new Uint8Array(imageWidth * imageHeight);
  const bounds = cutoutPolygonBounds(polygon);
  if (!bounds || polygon.length < 3 || imageWidth < 1 || imageHeight < 1) return mask;

  const left = clamp(Math.floor(bounds.x), 0, imageWidth);
  const top = clamp(Math.floor(bounds.y), 0, imageHeight);
  const right = clamp(Math.ceil(bounds.x + bounds.width), left, imageWidth);
  const bottom = clamp(Math.ceil(bounds.y + bounds.height), top, imageHeight);
  const coverage = new Float32Array(Math.max(0, right - left));

  for (let y = top; y < bottom; y += 1) {
    coverage.fill(0);
    for (let sample = 0; sample < POLYGON_VERTICAL_SAMPLES; sample += 1) {
      const sampleY = y + (sample + 0.5) / POLYGON_VERTICAL_SAMPLES;
      const intersections: number[] = [];
      for (let current = 0, previous = polygon.length - 1;
        current < polygon.length;
        previous = current++) {
        const a = polygon[current];
        const b = polygon[previous];
        if ((a.y > sampleY) === (b.y > sampleY)) continue;
        intersections.push(a.x + (sampleY - a.y) * (b.x - a.x) / (b.y - a.y));
      }
      intersections.sort((a, b) => a - b);

      for (let index = 0; index + 1 < intersections.length; index += 2) {
        const start = clamp(intersections[index], left, right);
        const end = clamp(intersections[index + 1], left, right);
        if (end <= start) continue;
        const firstPixel = Math.floor(start);
        const lastPixel = Math.ceil(end) - 1;
        if (firstPixel === lastPixel) {
          coverage[firstPixel - left] += (end - start) / POLYGON_VERTICAL_SAMPLES;
          continue;
        }
        coverage[firstPixel - left] +=
          (Math.min(firstPixel + 1, end) - start) / POLYGON_VERTICAL_SAMPLES;
        for (let x = firstPixel + 1; x < lastPixel; x += 1) {
          coverage[x - left] += 1 / POLYGON_VERTICAL_SAMPLES;
        }
        coverage[lastPixel - left] +=
          (end - lastPixel) / POLYGON_VERTICAL_SAMPLES;
      }
    }

    const row = y * imageWidth;
    for (let x = left; x < right; x += 1) {
      mask[row + x] = Math.round(clamp(coverage[x - left], 0, 1) * 255);
    }
  }
  return mask;
}

export function constrainAlphaToSelection(
  alpha: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  selection: CutoutSelection
) {
  if (!selection.polygon?.length) return alpha;
  if (alpha.length !== imageWidth * imageHeight) {
    throw new Error("遮罩尺寸与点选轮廓不匹配。");
  }
  const polygonAlpha = rasterizeCutoutPolygon(imageWidth, imageHeight, selection.polygon);
  const constrained = new Uint8Array(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    constrained[index] = Math.round(alpha[index] * polygonAlpha[index] / 255);
  }
  return constrained;
}
