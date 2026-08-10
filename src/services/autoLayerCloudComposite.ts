import { compositeMaskedRgba } from "@/services/cutoutRepairCompositing";
import type { CutoutSelectionBox } from "@/types";

function clampedBounds(box: CutoutSelectionBox, width: number, height: number) {
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(width, Math.ceil(box.x + box.width));
  const bottom = Math.min(height, Math.ceil(box.y + box.height));
  return { left, top, right, bottom };
}

export function createAutoLayerCloudCompositeMask(
  width: number,
  height: number,
  boxes: readonly CutoutSelectionBox[]
) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("自动分层云背景尺寸无效。");
  }
  const mask = new Uint8Array(width * height);
  for (const box of boxes) {
    const bounds = clampedBounds(box, width, height);
    const boxWidth = bounds.right - bounds.left;
    const boxHeight = bounds.bottom - bounds.top;
    if (boxWidth <= 0 || boxHeight <= 0) continue;
    const feather = Math.min(
      24,
      Math.max(0, Math.min(
        Math.round(Math.min(boxWidth, boxHeight) * 0.04),
        Math.floor((Math.min(boxWidth, boxHeight) - 1) / 2)
      ))
    );
    for (let y = bounds.top; y < bounds.bottom; y += 1) {
      for (let x = bounds.left; x < bounds.right; x += 1) {
        const distance = Math.min(
          x - bounds.left,
          bounds.right - 1 - x,
          y - bounds.top,
          bounds.bottom - 1 - y
        );
        const alpha = feather > 0 ? Math.min(255, Math.round(distance / feather * 255)) : 255;
        const index = y * width + x;
        if (alpha > mask[index]) mask[index] = alpha;
      }
    }
  }
  return mask;
}

export function compositeAutoLayerCloudRgba(
  source: Uint8ClampedArray,
  repaired: Uint8ClampedArray,
  width: number,
  height: number,
  boxes: readonly CutoutSelectionBox[]
) {
  return compositeMaskedRgba(
    source,
    repaired,
    createAutoLayerCloudCompositeMask(width, height, boxes)
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
