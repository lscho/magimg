import type { CutoutSelectionBox } from "@/types";
import { cutoutSelectionBounds } from "@/services/cutoutGeometry";

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片导出失败，请稍后重试。"))),
      mimeType,
      quality
    );
  });
}

function nearbyTransparentBackground(
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  maskWidth: number,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
  x: number,
  y: number
) {
  for (let radius = 1; radius <= 8; radius += 1) {
    let red = 0;
    let green = 0;
    let blue = 0;
    let samples = 0;
    const left = Math.max(0, x - radius);
    const right = Math.min(boxWidth - 1, x + radius);
    const top = Math.max(0, y - radius);
    const bottom = Math.min(boxHeight - 1, y + radius);
    for (let sampleY = top; sampleY <= bottom; sampleY += 1) {
      for (let sampleX = left; sampleX <= right; sampleX += 1) {
        if (sampleX !== left && sampleX !== right && sampleY !== top && sampleY !== bottom) continue;
        if (mask[(boxY + sampleY) * maskWidth + boxX + sampleX] > 8) continue;
        const offset = (sampleY * boxWidth + sampleX) * 4;
        red += pixels[offset];
        green += pixels[offset + 1];
        blue += pixels[offset + 2];
        samples += 1;
      }
    }
    if (samples >= 1) return [red / samples, green / samples, blue / samples] as const;
  }
  return null;
}

export function decontaminateCutoutRgba(
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  maskWidth: number,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number
) {
  const sourcePixels = pixels.slice();
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const maskValue = mask[(boxY + y) * maskWidth + boxX + x];
      const offset = (y * boxWidth + x) * 4;
      if (maskValue <= 8) {
        pixels[offset] = 0;
        pixels[offset + 1] = 0;
        pixels[offset + 2] = 0;
        pixels[offset + 3] = 0;
        continue;
      }
      if (maskValue >= 248) {
        pixels[offset + 3] = Math.round(pixels[offset + 3] * maskValue / 255);
        continue;
      }
      const background = nearbyTransparentBackground(
        sourcePixels,
        mask,
        maskWidth,
        boxX,
        boxY,
        boxWidth,
        boxHeight,
        x,
        y
      );
      if (background) {
        const alpha = maskValue / 255;
        for (let channel = 0; channel < 3; channel += 1) {
          pixels[offset + channel] = Math.max(0, Math.min(255, Math.round(
            (pixels[offset + channel] - (1 - alpha) * background[channel]) / alpha
          )));
        }
      }
      pixels[offset + 3] = Math.round(pixels[offset + 3] * maskValue / 255);
    }
  }
}

/**
 * 将原图与 mask 合成为透明背景 PNG，并按选区 bbox 裁剪输出。
 * mask 尺寸需与原图一致，取值 0..255；输出 alpha 与原图 alpha 相乘。
 */
export async function maskToTransparentPng(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  mask: Uint8Array,
  sourceBox: CutoutSelectionBox,
  mimeType = "image/png",
  quality?: number
): Promise<{ blob: Blob; width: number; height: number; thumbnailUrl: string }> {
  if (mask.length !== imageWidth * imageHeight) {
    throw new Error("遮罩尺寸与图片不匹配，无法合成透明素材。");
  }

  // 按选区 bbox 裁剪，输出仅包含抠出元素的透明 PNG。
  const bounds = cutoutSelectionBounds(imageWidth, imageHeight, sourceBox);
  const { x: boxX, y: boxY, width: boxW, height: boxH } = bounds;

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = boxW;
  outputCanvas.height = boxH;
  const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
  if (!outputContext) throw new Error("当前设备无法导出该图片。");
  outputContext.clearRect(0, 0, boxW, boxH);
  outputContext.drawImage(image, boxX, boxY, boxW, boxH, 0, 0, boxW, boxH);

  const imageData = outputContext.getImageData(0, 0, boxW, boxH);
  const pixels = imageData.data;
  decontaminateCutoutRgba(pixels, mask, imageWidth, boxX, boxY, boxW, boxH);
  outputContext.putImageData(imageData, 0, 0);

  const blob = await canvasToBlob(outputCanvas, mimeType, quality);
  const thumbnailUrl = await createThumbnail(outputCanvas, 96);
  return { blob, width: boxW, height: boxH, thumbnailUrl };
}

async function createThumbnail(source: HTMLCanvasElement, maxSize: number): Promise<string> {
  const scale = Math.min(1, maxSize / Math.max(source.width, source.height));
  if (scale >= 1) return source.toDataURL("image/png");
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, Math.round(source.width * scale));
  thumb.height = Math.max(1, Math.round(source.height * scale));
  const context = thumb.getContext("2d");
  if (!context) return source.toDataURL("image/png");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL("image/png");
}
