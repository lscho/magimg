import { invoke } from "@tauri-apps/api/core";
import type { AutoLayerFontCategory } from "@/components/auto-layer/types";
import type { CutoutSelectionBox } from "@/types";

export interface AutoLayerOcrLine {
  id: string;
  text: string;
  confidence: number;
  box: CutoutSelectionBox;
  color: string;
  fontSize: number;
  fontWeight: number;
  fontCategory: AutoLayerFontCategory;
  glyphAlpha: Uint8Array;
  blob: Blob;
}

export interface AutoLayerClassification {
  type: string;
  confidence: number;
}

interface NativeOcrLine {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const autoLayerFontFamilies: Record<AutoLayerFontCategory, string> = {
  sans: "ui-sans-serif, system-ui, sans-serif",
  serif: "ui-serif, Georgia, serif",
  rounded: '"Arial Rounded MT Bold", ui-rounded, sans-serif',
  display: "Impact, Haettenschweiler, sans-serif",
  calligraphic: '"Kaiti SC", "STKaiti", cursive'
};

export interface FitAutoLayerTextInput {
  text: string;
  width: number;
  height: number;
  fontWeight: number;
  fontCategory: AutoLayerFontCategory;
  maxFontSize?: number;
}

function textMetrics(context: CanvasRenderingContext2D, input: FitAutoLayerTextInput, fontSize: number) {
  context.font = `${input.fontWeight} ${fontSize}px ${autoLayerFontFamilies[input.fontCategory]}`;
  const metrics = context.measureText(input.text);
  const measuredHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  return {
    width: metrics.width,
    height: measuredHeight > 0 ? measuredHeight : fontSize
  };
}

export function fitAutoLayerTextFontSize(input: FitAutoLayerTextInput) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const maximum = Math.max(4, Math.min(input.maxFontSize ?? input.height, input.height * 0.94));
  if (!context || !input.text.trim()) return Math.max(4, Math.round(maximum * 0.82));
  const availableWidth = Math.max(1, input.width * 0.96);
  const availableHeight = Math.max(1, input.height * 0.9);
  let low = 4;
  let high = maximum;
  for (let step = 0; step < 12; step += 1) {
    const candidate = (low + high) / 2;
    const metrics = textMetrics(context, input, candidate);
    if (metrics.width <= availableWidth && metrics.height <= availableHeight) low = candidate;
    else high = candidate;
  }
  return Math.max(4, Math.floor(low * 10) / 10);
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("文字选区编码失败。")),
    "image/png"
  ));
}

function cropCanvas(source: CanvasImageSource, box: CutoutSelectionBox) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.width));
  canvas.height = Math.max(1, Math.round(box.height));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法读取文字选区。");
  context.drawImage(source, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function dominantTextColor(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return "#ffffff";
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const luminances: number[] = [];
  for (let index = 0; index < data.length; index += 4) {
    luminances.push(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
  }
  luminances.sort((a, b) => a - b);
  const median = luminances[Math.floor(luminances.length / 2)] ?? 128;
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let index = 0; index < data.length; index += 4) {
    const luminance = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    if (Math.abs(luminance - median) < 36) continue;
    const r = Math.round(data[index] / 32) * 32;
    const g = Math.round(data[index + 1] / 32) * 32;
    const b = Math.round(data[index + 2] / 32) * 32;
    const key = `${r}-${g}-${b}`;
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += data[index];
    bucket.g += data[index + 1];
    bucket.b += data[index + 2];
    buckets.set(key, bucket);
  }
  const selected = [...buckets.values()].sort((a, b) => b.count - a.count)[0];
  if (!selected) return median > 128 ? "#20252b" : "#f3f5f7";
  const hex = (value: number) => Math.round(value / selected.count).toString(16).padStart(2, "0");
  return `#${hex(selected.r)}${hex(selected.g)}${hex(selected.b)}`;
}

export interface RenderAutoLayerTextInput {
  text: string;
  color: string;
  fontSize: number;
  fontWeight: number;
  fontCategory: AutoLayerFontCategory;
  width: number;
  height: number;
}

export function renderAutoLayerTextAsset(input: RenderAutoLayerTextInput) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(input.width));
  canvas.height = Math.max(1, Math.round(input.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成文字素材。");
  context.fillStyle = input.color;
  context.font = `${input.fontWeight} ${input.fontSize}px ${autoLayerFontFamilies[input.fontCategory]}`;
  context.textBaseline = "alphabetic";
  const metrics = context.measureText(input.text);
  const ascent = metrics.actualBoundingBoxAscent || input.fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || input.fontSize * 0.2;
  const x = Math.max(0, (canvas.width - metrics.width) / 2);
  const baseline = (canvas.height - ascent - descent) / 2 + ascent;
  context.fillText(input.text, x, baseline);
  return canvasBlob(canvas);
}

function channelMedian(values: number[]) {
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)] ?? 128;
}

function borderBackgroundColor(data: Uint8ClampedArray, width: number, height: number) {
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x > 1 && y > 1 && x < width - 2 && y < height - 2) continue;
      const offset = (y * width + x) * 4;
      red.push(data[offset]);
      green.push(data[offset + 1]);
      blue.push(data[offset + 2]);
    }
  }
  return [channelMedian(red), channelMedian(green), channelMedian(blue)] as const;
}

/**
 * Builds the removal matte from the original OCR crop instead of the editable
 * approximation. The later 2-4 px dilation absorbs outlines and antialiasing.
 */
export function inferAutoLayerTextGlyphAlphaFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number
) {
  if (data.length !== width * height * 4 || width <= 0 || height <= 0) {
    return new Uint8Array();
  }
  const background = borderBackgroundColor(data, width, height);
  const alpha = new Uint8Array(width * height);
  for (let pixel = 0; pixel < alpha.length; pixel += 1) {
    const offset = pixel * 4;
    const distance = Math.hypot(
      data[offset] - background[0],
      data[offset + 1] - background[1],
      data[offset + 2] - background[2]
    );
    if (distance >= 52) alpha[pixel] = 255;
  }
  return alpha;
}

export function inferAutoLayerFontStyleFromPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  text: string
) {
  if (data.length !== width * height * 4 || width <= 0 || height <= 0) {
    return { fontWeight: 400, fontCategory: "sans" as const };
  }
  const background = borderBackgroundColor(data, width, height);
  const foreground = new Uint8Array(width * height);
  let foregroundCount = 0;
  let edges = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const colorDistance = Math.hypot(
        data[index] - background[0],
        data[index + 1] - background[1],
        data[index + 2] - background[2]
      );
      if (colorDistance >= 52) {
        foreground[y * width + x] = 1;
        foregroundCount += 1;
      }
      if (!x) continue;
      const previous = index - 4;
      const delta = Math.abs(data[index] - data[previous])
        + Math.abs(data[index + 1] - data[previous + 1])
        + Math.abs(data[index + 2] - data[previous + 2]);
      if (delta > 90) edges += 1;
    }
  }
  const horizontalRuns = new Uint16Array(foreground.length);
  const verticalRuns = new Uint16Array(foreground.length);
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      if (!foreground[y * width + x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < width && foreground[y * width + x]) x += 1;
      horizontalRuns.fill(x - start, y * width + start, y * width + x);
    }
  }
  for (let x = 0; x < width; x += 1) {
    let y = 0;
    while (y < height) {
      if (!foreground[y * width + x]) {
        y += 1;
        continue;
      }
      const start = y;
      while (y < height && foreground[y * width + x]) y += 1;
      for (let fillY = start; fillY < y; fillY += 1) verticalRuns[fillY * width + x] = y - start;
    }
  }
  const thicknesses: number[] = [];
  let corePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!foreground[index]) continue;
      thicknesses.push(Math.min(horizontalRuns[index], verticalRuns[index]));
      if (
        x > 0 && x < width - 1 && y > 0 && y < height - 1 &&
        foreground[index - 1] && foreground[index + 1] &&
        foreground[index - width] && foreground[index + width]
      ) corePixels += 1;
    }
  }
  thicknesses.sort((left, right) => left - right);
  const strokeThickness = thicknesses[Math.floor(thicknesses.length * 0.75)] ?? 0;
  const relativeThickness = strokeThickness / Math.max(8, height);
  const coreRatio = corePixels / Math.max(1, foregroundCount);
  const isHan = /\p{Script=Han}/u.test(text);
  const isShortNumericLabel = /^\d{1,2}$/u.test(text.trim());
  const unmistakablyHeavy = isHan
    ? relativeThickness >= 0.3 && coreRatio >= 0.7
    : relativeThickness >= 0.28 && coreRatio >= 0.68;
  // Raster OCR crops cannot reliably distinguish a heavy font from outlines and shadows.
  // Short numeric UI labels are especially ambiguous, so keep them editable at regular weight.
  const fontWeight = unmistakablyHeavy && !isShortNumericLabel ? 600 : 400;
  const edgeDensity = edges / Math.max(1, width * height);
  let fontCategory: AutoLayerFontCategory = "sans";
  if (/^[A-Z0-9\s!?&-]+$/u.test(text) && text.length >= 3 && fontWeight >= 600) fontCategory = "display";
  else if (edgeDensity < 0.16 && fontWeight >= 600) fontCategory = "rounded";
  return { fontWeight, fontCategory };
}

export function normalizeAutoLayerOcrText(value: string) {
  let text = value.replace(/\s+/gu, " ").trim();
  if (/\p{Script=Han}/u.test(text)) {
    text = text
      .replace(/^[a-z\[\](){}<>]+(?=\p{Script=Han})/u, "")
      .replace(/(?<=\p{Script=Han})[a-z\[\](){}<>]+$/u, "");
  }
  if (/^[\[\](){}<>]*\d+[\[\](){}<>]*$/u.test(text)) {
    text = text.replace(/[^0-9]/gu, "");
  }
  return text;
}

function normalizeNumericOcrConfusions(value: string) {
  return value
    .replace(/[tIl|]/gu, "1")
    .replace(/[oO]/gu, "0");
}

export function chooseAutoLayerOcrLines(
  detected: readonly NativeOcrLine[],
  wholeLine: NativeOcrLine | undefined
): NativeOcrLine[] {
  if (!wholeLine?.text.trim()) return [...detected];
  if (!detected.length) return [wholeLine];
  if (detected.length > 1) {
    const reliableDetectedLines = detected.every(line => line.confidence >= 0.75);
    const detectedAverage = detected.reduce((sum, line) => sum + line.confidence, 0) / detected.length;
    if (detected.some(line => /\d/u.test(line.text)) && /^[tIl|oO]+$/u.test(wholeLine.text.trim())) {
      return [{ ...wholeLine, text: normalizeNumericOcrConfusions(wholeLine.text.trim()) }];
    }
    return reliableDetectedLines && wholeLine.confidence < detectedAverage - 0.1
      ? [...detected]
      : [wholeLine];
  }
  const current = detected[0];
  const wholeText = normalizeAutoLayerOcrText(wholeLine.text);
  const currentText = normalizeAutoLayerOcrText(current.text);
  const confidenceImproved = wholeLine.confidence >= current.confidence + 0.02;
  const recoveredCharacters = wholeText.length > currentText.length && wholeLine.confidence >= 0.75;
  return confidenceImproved || recoveredCharacters ? [wholeLine] : [...detected];
}

export async function recognizeAutoLayerText(
  source: CanvasImageSource,
  selection: CutoutSelectionBox,
  signal?: AbortSignal,
  onDiagnosticStage?: (stage: "detected" | "whole-line") => void
): Promise<AutoLayerOcrLine[]> {
  if (!isTauri) throw new Error("浏览器预览不能运行本地 OCR。");
  if (signal?.aborted) throw new DOMException("文字识别已取消。", "AbortError");
  const crop = cropCanvas(source, selection);
  const blob = await canvasBlob(crop);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const response = await invoke<ArrayBuffer>("auto_layer_ocr", bytes);
  onDiagnosticStage?.("detected");
  const directResponse = await invoke<ArrayBuffer>("auto_layer_ocr_line", bytes.slice());
  onDiagnosticStage?.("whole-line");
  const detected = JSON.parse(new TextDecoder().decode(new Uint8Array(response))) as NativeOcrLine[];
  const direct = JSON.parse(new TextDecoder().decode(new Uint8Array(directResponse))) as NativeOcrLine[];
  const lines = chooseAutoLayerOcrLines(detected, direct[0]);
  return Promise.all(lines.map(line => ({ ...line, text: normalizeAutoLayerOcrText(line.text) }))
    .filter(line => line.text)
    .map(async (line, index) => {
    const lineCanvas = cropCanvas(crop, {
      id: `${selection.id}-color-${index + 1}`,
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height
    });
    const lineContext = lineCanvas.getContext("2d", { willReadFrequently: true });
    if (!lineContext) throw new Error("当前设备无法读取文字像素。");
    const linePixels = lineContext.getImageData(0, 0, lineCanvas.width, lineCanvas.height).data;
    const color = dominantTextColor(lineCanvas);
    const style = inferAutoLayerFontStyleFromPixels(
      linePixels,
      lineCanvas.width,
      lineCanvas.height,
      line.text
    );
    const fontSize = fitAutoLayerTextFontSize({
      text: line.text.trim(),
      width: line.width,
      height: line.height,
      fontWeight: style.fontWeight,
      fontCategory: style.fontCategory
    });
    const box = {
      id: `${selection.id}-line-${index + 1}`,
      x: selection.x + line.x,
      y: selection.y + line.y,
      width: line.width,
      height: line.height
    };
    return {
      id: box.id,
      text: line.text.trim(),
      confidence: Math.max(0, Math.min(1, line.confidence)),
      box,
      color,
      fontSize,
      fontWeight: style.fontWeight,
      fontCategory: style.fontCategory,
      glyphAlpha: inferAutoLayerTextGlyphAlphaFromPixels(
        linePixels,
        lineCanvas.width,
        lineCanvas.height
      ),
      blob: await renderAutoLayerTextAsset({
        text: line.text.trim(),
        color,
        fontSize,
        fontWeight: style.fontWeight,
        fontCategory: style.fontCategory,
        width: line.width,
        height: line.height
      })
    };
    }));
}

export async function classifyAutoLayerElement(
  source: CanvasImageSource,
  box: CutoutSelectionBox
): Promise<AutoLayerClassification> {
  const result = await classifyAutoLayerElements(source, [box]);
  return result[0] ?? { type: "element", confidence: 0 };
}

export async function classifyAutoLayerElements(
  source: CanvasImageSource,
  boxes: readonly CutoutSelectionBox[],
  signal?: AbortSignal
): Promise<AutoLayerClassification[]> {
  if (!isTauri) throw new Error("浏览器预览不能运行本地元素识别。");
  if (!boxes.length) return [];
  const encoded = await Promise.all(boxes.map(box => canvasBlob(cropCanvas(source, box))));
  const buffers = await Promise.all(encoded.map(blob => blob.arrayBuffer()));
  const byteLength = 4 + buffers.reduce((sum, buffer) => sum + 4 + buffer.byteLength, 0);
  const payload = new Uint8Array(byteLength);
  const view = new DataView(payload.buffer);
  view.setUint32(0, buffers.length, true);
  let offset = 4;
  for (const buffer of buffers) {
    view.setUint32(offset, buffer.byteLength, true);
    offset += 4;
    payload.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  if (signal?.aborted) throw new DOMException("元素识别已取消。", "AbortError");
  const response = await invoke<ArrayBuffer>("auto_layer_classify", payload);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(response))) as AutoLayerClassification[];
}

export async function releaseAutoLayerRecognition() {
  if (isTauri) await invoke("auto_layer_release");
}
