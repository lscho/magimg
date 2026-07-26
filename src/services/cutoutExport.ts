import type { CutoutSelectionBox } from "@/types";

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片导出失败，请稍后重试。"))),
      mimeType,
      quality
    );
  });
}

/**
 * 将原图与 mask 合成为透明背景 PNG，并按选区 bbox 裁剪输出。
 * mask 尺寸需与原图一致；mask=0 处 alpha 置 0。
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
  const boxX = Math.max(0, Math.min(imageWidth - 1, Math.round(sourceBox.x)));
  const boxY = Math.max(0, Math.min(imageHeight - 1, Math.round(sourceBox.y)));
  const boxW = Math.max(1, Math.min(imageWidth - boxX, Math.round(sourceBox.width)));
  const boxH = Math.max(1, Math.min(imageHeight - boxY, Math.round(sourceBox.height)));

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = boxW;
  outputCanvas.height = boxH;
  const outputContext = outputCanvas.getContext("2d", { willReadFrequently: true });
  if (!outputContext) throw new Error("当前设备无法导出该图片。");
  outputContext.clearRect(0, 0, boxW, boxH);
  outputContext.drawImage(image, boxX, boxY, boxW, boxH, 0, 0, boxW, boxH);

  const imageData = outputContext.getImageData(0, 0, boxW, boxH);
  const pixels = imageData.data;
  for (let y = 0; y < boxH; y += 1) {
    const maskRow = (boxY + y) * imageWidth + boxX;
    const pixelRow = y * boxW;
    for (let x = 0; x < boxW; x += 1) {
      const alphaIndex = (pixelRow + x) * 4 + 3;
      pixels[alphaIndex] = mask[maskRow + x] > 0 ? pixels[alphaIndex] : 0;
    }
  }
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
