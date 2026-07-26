import type { CutoutSelectionBox } from "@/types";

export interface CutoutPixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function cutoutSelectionBounds(
  imageWidth: number,
  imageHeight: number,
  sourceBox: CutoutSelectionBox
): CutoutPixelBounds {
  const x = Math.max(0, Math.min(imageWidth - 1, Math.round(sourceBox.x)));
  const y = Math.max(0, Math.min(imageHeight - 1, Math.round(sourceBox.y)));
  const width = Math.max(1, Math.min(imageWidth - x, Math.round(sourceBox.width)));
  const height = Math.max(1, Math.min(imageHeight - y, Math.round(sourceBox.height)));
  return { x, y, width, height };
}
