import type { CutoutBrushPoint, CutoutSelection } from "@/types";

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
  const constrained = new Uint8Array(alpha.length);
  const left = Math.max(0, Math.floor(selection.x));
  const top = Math.max(0, Math.floor(selection.y));
  const right = Math.min(imageWidth, Math.ceil(selection.x + selection.width));
  const bottom = Math.min(imageHeight, Math.ceil(selection.y + selection.height));
  for (let y = top; y < bottom; y += 1) {
    const row = y * imageWidth;
    for (let x = left; x < right; x += 1) {
      if (pointInCutoutPolygon({ x: x + 0.5, y: y + 0.5 }, selection.polygon)) {
        constrained[row + x] = alpha[row + x];
      }
    }
  }
  return constrained;
}
