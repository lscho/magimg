import { invoke } from "@tauri-apps/api/core";
import { CUTOUT_REPAIR_MODEL } from "@/services/cutoutRepairModelManager";
import { compositeMaskedRgba } from "@/services/cutoutRepairCompositing";
import {
  buildCutoutRepairLayoutFromBounds,
  type CutoutRepairLayout
} from "@/services/cutoutRepairLayout";
import {
  analyzeMaterialContext,
  alphaContentBounds,
  cropAlpha,
  diffuseRepairRgba,
  fillRgbaOutsideAlpha
} from "@/services/cutoutRepairContext";
import type { CutoutSelectionBox } from "@/types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function abortError() {
  return new DOMException("背景修复已取消。", "AbortError");
}

function normalizeNativeError(exception: unknown) {
  if (exception instanceof Error) return exception;
  if (typeof exception === "string" && exception.trim()) return new Error(exception.trim());
  return new Error("原生背景修复失败，请稍后重试。");
}

function responseBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return Uint8Array.from(value as number[]);
  }
  throw new Error("原生背景修复返回了无法识别的图片数据。");
}

function maskCropCanvas(
  mask: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  bounds: CutoutRepairLayout["bounds"]
) {
  if (mask.length !== imageWidth * imageHeight) {
    throw new Error("背景修复蒙版尺寸与图片不匹配。");
  }
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法准备背景修复蒙版。");
  const imageData = context.createImageData(bounds.width, bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceRow = (bounds.y + y) * imageWidth + bounds.x;
    const targetRow = y * bounds.width;
    for (let x = 0; x < bounds.width; x += 1) {
      const value = mask[sourceRow + x];
      const offset = (targetRow + x) * 4;
      imageData.data[offset] = value;
      imageData.data[offset + 1] = value;
      imageData.data[offset + 2] = value;
      imageData.data[offset + 3] = 255;
    }
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

interface LocalRepairContext {
  canvas: HTMLCanvasElement;
  sourceRgba: Uint8ClampedArray;
  parentAlpha: Uint8Array;
  repairMask: Uint8Array;
  fillColor: readonly [number, number, number];
  useDiffusion: boolean;
}

function prepareRepairContext(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  parentAlpha: Uint8Array,
  repairMask: Uint8Array,
  bounds: CutoutRepairLayout["bounds"]
): LocalRepairContext {
  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法准备背景修复上下文。");
  context.drawImage(
    image,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height
  );
  const imageData = context.getImageData(0, 0, bounds.width, bounds.height);
  const croppedParentAlpha = cropAlpha(parentAlpha, imageWidth, imageHeight, bounds);
  const croppedRepairMask = cropAlpha(repairMask, imageWidth, imageHeight, bounds);
  const analysis = analyzeMaterialContext(
    imageData.data,
    croppedParentAlpha,
    croppedRepairMask,
    bounds.width,
    bounds.height
  );
  const filled = fillRgbaOutsideAlpha(
    imageData.data,
    croppedParentAlpha,
    bounds.width,
    bounds.height,
    analysis.fillColor
  );
  imageData.data.set(filled);
  context.putImageData(imageData, 0, 0);
  return {
    canvas,
    sourceRgba: imageData.data.slice(),
    parentAlpha: croppedParentAlpha,
    repairMask: croppedRepairMask,
    fillColor: analysis.fillColor,
    useDiffusion: analysis.useDiffusion
  };
}

function prepareLocalInput(
  repairContext: LocalRepairContext,
  layout: CutoutRepairLayout
) {
  const { inputWidth, inputHeight } = CUTOUT_REPAIR_MODEL;
  const { bounds, inputRect } = layout;
  const imageCanvas = document.createElement("canvas");
  imageCanvas.width = inputWidth;
  imageCanvas.height = inputHeight;
  const imageContext = imageCanvas.getContext("2d", { willReadFrequently: true });
  if (!imageContext) throw new Error("当前设备无法准备背景修复图片。");
  imageContext.imageSmoothingEnabled = true;
  imageContext.imageSmoothingQuality = "high";
  imageContext.fillStyle = `rgb(${repairContext.fillColor.join(", ")})`;
  imageContext.fillRect(0, 0, inputWidth, inputHeight);
  imageContext.drawImage(
    repairContext.canvas,
    0,
    0,
    bounds.width,
    bounds.height,
    inputRect.x,
    inputRect.y,
    inputRect.width,
    inputRect.height
  );

  const scaledMaskCanvas = document.createElement("canvas");
  scaledMaskCanvas.width = inputWidth;
  scaledMaskCanvas.height = inputHeight;
  const maskContext = scaledMaskCanvas.getContext("2d", { willReadFrequently: true });
  if (!maskContext) throw new Error("当前设备无法准备背景修复蒙版。");
  maskContext.imageSmoothingEnabled = false;
  maskContext.drawImage(
    maskCropCanvas(repairContext.repairMask, bounds.width, bounds.height, {
      x: 0,
      y: 0,
      width: bounds.width,
      height: bounds.height
    }),
    inputRect.x,
    inputRect.y,
    inputRect.width,
    inputRect.height
  );

  const rgba = imageContext.getImageData(0, 0, inputWidth, inputHeight).data;
  const maskRgba = maskContext.getImageData(0, 0, inputWidth, inputHeight).data;
  const planeSize = inputWidth * inputHeight;
  const input = new Float32Array(planeSize * 4);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    const offset = pixel * 4;
    input[pixel] = rgba[offset] / 255;
    input[planeSize + pixel] = rgba[offset + 1] / 255;
    input[planeSize * 2 + pixel] = rgba[offset + 2] / 255;
    input[planeSize * 3 + pixel] = maskRgba[offset] >= 32 ? 1 : 0;
  }
  return input;
}

function repairedModelCanvas(bytes: Uint8Array) {
  const { inputWidth, inputHeight } = CUTOUT_REPAIR_MODEL;
  const planeSize = inputWidth * inputHeight;
  if (bytes.length !== planeSize * 3) {
    throw new Error("背景修复模型返回的图片尺寸无效。");
  }
  const canvas = document.createElement("canvas");
  canvas.width = inputWidth;
  canvas.height = inputHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法合成背景修复结果。");
  const imageData = context.createImageData(inputWidth, inputHeight);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    const offset = pixel * 4;
    imageData.data[offset] = bytes[pixel];
    imageData.data[offset + 1] = bytes[planeSize + pixel];
    imageData.data[offset + 2] = bytes[planeSize * 2 + pixel];
    imageData.data[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export async function repairBackgroundLocally(
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  repairMask: Uint8Array,
  parentAlpha: Uint8Array,
  box: CutoutSelectionBox,
  options: {
    signal?: AbortSignal;
    forceDiffusion?: boolean;
  } = {}
) {
  const { signal, forceDiffusion = false } = options;
  if (!isTauri) throw new Error("浏览器预览不能运行本地背景修复模型。");
  if (signal?.aborted) throw abortError();
  const layout = buildCutoutRepairLayoutFromBounds(
    alphaContentBounds(parentAlpha, imageWidth, imageHeight, box),
    CUTOUT_REPAIR_MODEL.inputWidth,
    CUTOUT_REPAIR_MODEL.inputHeight
  );
  const { bounds, inputRect } = layout;
  const repairContext = prepareRepairContext(
    image,
    imageWidth,
    imageHeight,
    parentAlpha,
    repairMask,
    bounds
  );
  let repairedPixels: Uint8ClampedArray;
  if (forceDiffusion || repairContext.useDiffusion) {
    repairedPixels = diffuseRepairRgba(
      repairContext.sourceRgba,
      repairContext.parentAlpha,
      repairContext.repairMask,
      bounds.width,
      bounds.height,
      repairContext.fillColor
    );
  } else {
    const input = prepareLocalInput(repairContext, layout);
    const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const handleAbort = () => { void invoke("cutout_cancel").catch(() => undefined); };
    signal?.addEventListener("abort", handleAbort, { once: true });
    let response: unknown;
    try {
      response = await invoke<ArrayBuffer>("cutout_repair", bytes, {
        headers: { "x-cutout-repair-id": CUTOUT_REPAIR_MODEL.id }
      });
    } catch (exception) {
      if (signal?.aborted) throw abortError();
      throw normalizeNativeError(exception);
    } finally {
      signal?.removeEventListener("abort", handleAbort);
    }
    if (signal?.aborted) throw abortError();

    const repaired = repairedModelCanvas(responseBytes(response));
    const repairedCrop = document.createElement("canvas");
    repairedCrop.width = bounds.width;
    repairedCrop.height = bounds.height;
    const repairedContext = repairedCrop.getContext("2d", { willReadFrequently: true });
    if (!repairedContext) throw new Error("当前设备无法合成背景修复结果。");
    repairedContext.imageSmoothingEnabled = true;
    repairedContext.imageSmoothingQuality = "high";
    repairedContext.drawImage(
      repaired,
      inputRect.x,
      inputRect.y,
      inputRect.width,
      inputRect.height,
      0,
      0,
      bounds.width,
      bounds.height
    );
    repairedPixels = repairedContext.getImageData(
      0,
      0,
      bounds.width,
      bounds.height
    ).data;
  }
  if (signal?.aborted) throw abortError();

  const output = document.createElement("canvas");
  output.width = imageWidth;
  output.height = imageHeight;
  const context = output.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法合成背景修复结果。");
  context.drawImage(image, 0, 0, imageWidth, imageHeight);
  const sourcePixels = context.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
  sourcePixels.data.set(compositeMaskedRgba(
    sourcePixels.data,
    repairedPixels,
    repairContext.repairMask
  ));
  context.putImageData(sourcePixels, bounds.x, bounds.y);
  return output;
}

export async function maskToPngBlob(mask: Uint8Array, width: number, height: number) {
  if (mask.length !== width * height) throw new Error("云端修复蒙版尺寸无效。");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成云端修复蒙版。");
  const imageData = context.createImageData(width, height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    imageData.data[offset] = mask[pixel];
    imageData.data[offset + 1] = mask[pixel];
    imageData.data[offset + 2] = mask[pixel];
    imageData.data[offset + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("云端修复蒙版生成失败。")), "image/png");
  });
}

export async function imageBlobSource(blob: Blob) {
  return createImageBitmap(blob);
}

export function compositeRepairedImage(
  source: CanvasImageSource,
  repaired: CanvasImageSource,
  mask: Uint8Array,
  width: number,
  height: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法合成云端修复结果。");
  context.drawImage(source, 0, 0, width, height);
  const sourcePixels = context.getImageData(0, 0, width, height);
  const repairedCanvas = document.createElement("canvas");
  repairedCanvas.width = width;
  repairedCanvas.height = height;
  const repairedContext = repairedCanvas.getContext("2d", { willReadFrequently: true });
  if (!repairedContext) throw new Error("当前设备无法读取云端修复结果。");
  repairedContext.drawImage(repaired, 0, 0, width, height);
  const repairedPixels = repairedContext.getImageData(0, 0, width, height).data;
  sourcePixels.data.set(compositeMaskedRgba(sourcePixels.data, repairedPixels, mask));
  context.putImageData(sourcePixels, 0, 0);
  return canvas;
}
