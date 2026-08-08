import type { AutoLayerItem } from "@/components/auto-layer/types";
import { cutoutSelectionBounds } from "@/services/cutoutGeometry";
import type { CutoutSelectionBox } from "@/types";

const ATLAS_GUTTER = 24;
/**
 * 图集单边硬上限。超大原图统一压缩到 2K（2048px）以内再上传云端：
 * 只有原图超过该值才缩放，小图保持原分辨率不动，避免无谓的清晰度损失。
 */
const DEFAULT_MAX_EDGE = 2048;
const DEFAULT_MAX_PIXELS = 16_777_216;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_BYTE_HEADROOM = 0.94;
const MIN_ATLAS_SCALE = 0.25;
/** 单张图集缩放低于该值视为超载，拆分为整页背景与父素材两张图集、两个云端任务。 */
export const AUTO_LAYER_ATLAS_SPLIT_SCALE = 0.9;

/**
 * 单图统一缩放是否已经明显损伤父素材裁片分辨率：
 * 存在父素材且缩放低于阈值时拆分，让整页背景与父素材各自独立缩放。
 */
export function shouldSplitAutoLayerAtlas(scale: number, hasMaterials: boolean) {
  return hasMaterials && scale < AUTO_LAYER_ATLAS_SPLIT_SCALE;
}

interface AtlasSourceTile {
  key: string;
  width: number;
  height: number;
}

interface AtlasPlacement {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AutoLayerRepairRegion {
  layerId: string;
  contextBox: CutoutSelectionBox;
  contentBox: CutoutSelectionBox;
  mask: Uint8Array;
}

export interface AutoLayerRepairAtlasTile {
  kind: "background" | "material";
  layerId?: string;
  sourceBox: CutoutSelectionBox;
  atlasBox: CutoutSelectionBox;
  contentAtlasBox: CutoutSelectionBox;
}

export interface AutoLayerRepairAtlas {
  imageBlob: Blob;
  maskBlob: Blob;
  width: number;
  height: number;
  scale: number;
  tiles: AutoLayerRepairAtlasTile[];
  sourceMasks: AutoLayerRepairSourceMask[];
}

export interface AutoLayerRepairSourceMask {
  kind: "background" | "material";
  layerId?: string;
  width: number;
  height: number;
  values: Uint8Array;
}

export interface AutoLayerRepairAtlasResult {
  backgroundBlob: Blob;
  layers: AutoLayerItem[];
}

export interface AutoLayerRepairAtlasSource {
  backgroundBlob: Blob;
  layers: readonly AutoLayerItem[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundUp(value: number, step: number) {
  return Math.ceil(value / step) * step;
}

function canvasBlob(canvas: HTMLCanvasElement, mimeType = "image/png", quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("云端背景图集编码失败。")),
    mimeType,
    quality
  ));
}

export function autoLayerAtlasFileName(blob: Blob) {
  if (blob.type === "image/webp") return "auto-layer-repair-atlas.webp";
  if (blob.type === "image/jpeg") return "auto-layer-repair-atlas.jpg";
  return "auto-layer-repair-atlas.png";
}

export function nextAutoLayerAtlasPixelBudget(
  currentPixels: number,
  imageBytes: number,
  maskBytes: number,
  maxBytes: number
) {
  const targetBytes = Math.max(1, Math.floor(maxBytes * UPLOAD_BYTE_HEADROOM));
  const overflowRatio = Math.max(imageBytes, maskBytes) / targetBytes;
  if (overflowRatio <= 1) return Math.max(1, Math.floor(currentPixels));
  return Math.max(1, Math.floor(currentPixels / overflowRatio * 0.88));
}

async function encodeAtlasImage(canvas: HTMLCanvasElement, targetBytes: number) {
  const png = await canvasBlob(canvas);
  if (png.size <= targetBytes) return png;

  let smallest = png;
  for (const quality of [0.94, 0.9]) {
    const webp = await canvasBlob(canvas, "image/webp", quality);
    if (webp.type !== "image/webp") break;
    if (webp.size < smallest.size) smallest = webp;
    if (webp.size <= targetBytes) return webp;
  }
  return smallest;
}

function packAtWidth(tiles: readonly AtlasSourceTile[], scale: number, widthLimit: number) {
  const gutter = Math.max(8, Math.round(ATLAS_GUTTER * scale));
  const placements: AtlasPlacement[] = [];
  let x = gutter;
  let y = gutter;
  let rowHeight = 0;
  let usedWidth = 0;

  for (const tile of tiles) {
    const width = Math.max(1, Math.round(tile.width * scale));
    const height = Math.max(1, Math.round(tile.height * scale));
    if (x > gutter && x + width + gutter > widthLimit) {
      x = gutter;
      y += rowHeight + gutter;
      rowHeight = 0;
    }
    placements.push({ key: tile.key, x, y, width, height });
    x += width + gutter;
    rowHeight = Math.max(rowHeight, height);
    usedWidth = Math.max(usedWidth, x);
  }

  return {
    placements,
    width: roundUp(Math.max(16, usedWidth), 16),
    height: roundUp(Math.max(16, y + rowHeight + gutter), 16)
  };
}

function bestPacking(tiles: readonly AtlasSourceTile[], scale: number, maxEdge: number) {
  const gutter = Math.max(8, Math.round(ATLAS_GUTTER * scale));
  const largest = Math.max(...tiles.map(tile => Math.round(tile.width * scale))) + gutter * 2;
  const totalArea = tiles.reduce((sum, tile) => sum + tile.width * tile.height * scale * scale, 0);
  const widths = new Set([
    clamp(roundUp(largest, 16), 16, maxEdge),
    clamp(roundUp(Math.sqrt(totalArea * 1.2), 16), 16, maxEdge),
    clamp(roundUp(Math.sqrt(totalArea * 1.8), 16), 16, maxEdge),
    maxEdge
  ]);
  return [...widths]
    .map(width => packAtWidth(tiles, scale, width))
    .filter(layout => layout.width <= maxEdge && layout.height <= maxEdge)
    .sort((left, right) => {
      const leftAspect = Math.max(left.width / left.height, left.height / left.width);
      const rightAspect = Math.max(right.width / right.height, right.height / right.width);
      return left.width * left.height - right.width * right.height || leftAspect - rightAspect;
    })[0] ?? null;
}

export function layoutAutoLayerRepairTiles(
  tiles: readonly AtlasSourceTile[],
  maxPixels = DEFAULT_MAX_PIXELS,
  maxEdge = DEFAULT_MAX_EDGE
) {
  if (!tiles.length) throw new Error("云端背景图集没有可修复区域。");
  const safeMaxPixels = Math.max(1, Math.floor(maxPixels));
  const safeMaxEdge = Math.max(256, Math.floor(maxEdge));
  let scale = Math.min(1, safeMaxEdge / Math.max(...tiles.flatMap(tile => [tile.width, tile.height])));

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const layout = bestPacking(tiles, scale, safeMaxEdge);
    if (layout && layout.width * layout.height <= safeMaxPixels) return { ...layout, scale };
    const currentPixels = layout ? layout.width * layout.height : safeMaxEdge * safeMaxEdge;
    const pixelScale = Math.sqrt(safeMaxPixels / Math.max(1, currentPixels));
    scale *= Math.min(0.92, pixelScale * 0.96);
    if (scale < MIN_ATLAS_SCALE) break;
  }
  throw new Error("图片与父级背景超出单次云端修复容量，请减少图片尺寸后重试。");
}

function maskCropCanvas(mask: Uint8Array, imageWidth: number, imageHeight: number, box: CutoutSelectionBox) {
  if (mask.length !== imageWidth * imageHeight) throw new Error("云端背景蒙版尺寸无效。");
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(imageWidth, Math.ceil(box.x + box.width));
  const bottom = Math.min(imageHeight, Math.ceil(box.y + box.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, right - left);
  canvas.height = Math.max(1, bottom - top);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成云端背景蒙版。");
  const pixels = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const value = mask[(top + y) * imageWidth + left + x];
      const offset = (y * canvas.width + x) * 4;
      pixels.data[offset] = value;
      pixels.data[offset + 1] = value;
      pixels.data[offset + 2] = value;
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function maskCropPlane(mask: Uint8Array, imageWidth: number, imageHeight: number, box: CutoutSelectionBox) {
  if (mask.length !== imageWidth * imageHeight) throw new Error("云端背景蒙版尺寸无效。");
  const bounds = cutoutSelectionBounds(imageWidth, imageHeight, box);
  const values = new Uint8Array(bounds.width * bounds.height);
  for (let y = 0; y < bounds.height; y += 1) {
    const sourceStart = (bounds.y + y) * imageWidth + bounds.x;
    values.set(mask.subarray(sourceStart, sourceStart + bounds.width), y * bounds.width);
  }
  return { width: bounds.width, height: bounds.height, values };
}

export interface AutoLayerRepairAtlasOptions {
  source: CanvasImageSource;
  imageWidth: number;
  imageHeight: number;
  backgroundMask: Uint8Array;
  regions: readonly AutoLayerRepairRegion[];
  maxPixels?: number;
  maxBytes?: number;
  /** 拆分模式：false 时只打包父素材裁片，不含整页背景瓦片。 */
  includeBackground?: boolean;
}

export async function createAutoLayerRepairAtlas(
  options: AutoLayerRepairAtlasOptions
): Promise<AutoLayerRepairAtlas> {
  const includeBackground = options.includeBackground ?? true;
  const backgroundBox: CutoutSelectionBox = {
    id: "auto-layer-background",
    x: 0,
    y: 0,
    width: options.imageWidth,
    height: options.imageHeight
  };
  const sources: AtlasSourceTile[] = [
    ...(includeBackground
      ? [{ key: "background", width: options.imageWidth, height: options.imageHeight }]
      : []),
    ...options.regions.map(region => ({
      key: `material:${region.layerId}`,
      width: region.contextBox.width,
      height: region.contextBox.height
    }))
  ];
  const entries = [
    ...(includeBackground
      ? [{ kind: "background" as const, sourceBox: backgroundBox, mask: options.backgroundMask }]
      : []),
    ...options.regions.map(region => ({
      kind: "material" as const,
      layerId: region.layerId,
      sourceBox: region.contextBox,
      contentBox: region.contentBox,
      mask: region.mask
    }))
  ];
  if (!sources.length) throw new Error("云端背景图集没有可修复区域。");
  const sourceMasks: AutoLayerRepairSourceMask[] = entries.map(entry => {
    const contentBox = entry.kind === "background" ? entry.sourceBox : entry.contentBox;
    return {
      kind: entry.kind,
      ...(entry.kind === "material" ? { layerId: entry.layerId } : {}),
      ...maskCropPlane(entry.mask, options.imageWidth, options.imageHeight, contentBox)
    };
  });
  const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? DEFAULT_MAX_BYTES));
  const targetBytes = Math.max(1, Math.floor(maxBytes * UPLOAD_BYTE_HEADROOM));
  let pixelBudget = Math.max(1, Math.floor(options.maxPixels ?? DEFAULT_MAX_PIXELS));

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const layout = layoutAutoLayerRepairTiles(sources, pixelBudget);
    const placementByKey = new Map(layout.placements.map(placement => [placement.key, placement]));
    const imageCanvas = document.createElement("canvas");
    const maskCanvas = document.createElement("canvas");
    imageCanvas.width = maskCanvas.width = layout.width;
    imageCanvas.height = maskCanvas.height = layout.height;
    const imageContext = imageCanvas.getContext("2d");
    const maskContext = maskCanvas.getContext("2d");
    if (!imageContext || !maskContext) throw new Error("当前设备无法生成云端背景图集。");
    imageContext.fillStyle = "#101419";
    imageContext.fillRect(0, 0, layout.width, layout.height);
    maskContext.fillStyle = "#000000";
    maskContext.fillRect(0, 0, layout.width, layout.height);
    imageContext.imageSmoothingEnabled = true;
    imageContext.imageSmoothingQuality = "high";
    maskContext.imageSmoothingEnabled = false;
    const tiles: AutoLayerRepairAtlasTile[] = [];

    for (const entry of entries) {
      const key = entry.kind === "background" ? "background" : `material:${entry.layerId}`;
      const placement = placementByKey.get(key);
      if (!placement) throw new Error("云端背景图集布局无效。");
      imageContext.drawImage(
        options.source,
        entry.sourceBox.x,
        entry.sourceBox.y,
        entry.sourceBox.width,
        entry.sourceBox.height,
        placement.x,
        placement.y,
        placement.width,
        placement.height
      );
      const maskCrop = maskCropCanvas(entry.mask, options.imageWidth, options.imageHeight, entry.sourceBox);
      maskContext.drawImage(maskCrop, placement.x, placement.y, placement.width, placement.height);
      const contentBox = entry.kind === "background" ? entry.sourceBox : entry.contentBox;
      const scaleX = placement.width / entry.sourceBox.width;
      const scaleY = placement.height / entry.sourceBox.height;
      tiles.push({
        kind: entry.kind,
        ...(entry.kind === "material" ? { layerId: entry.layerId } : {}),
        sourceBox: { ...entry.sourceBox },
        atlasBox: { id: key, x: placement.x, y: placement.y, width: placement.width, height: placement.height },
        contentAtlasBox: {
          id: `${key}:content`,
          x: placement.x + (contentBox.x - entry.sourceBox.x) * scaleX,
          y: placement.y + (contentBox.y - entry.sourceBox.y) * scaleY,
          width: contentBox.width * scaleX,
          height: contentBox.height * scaleY
        }
      });
    }

    const [imageBlob, maskBlob] = await Promise.all([
      encodeAtlasImage(imageCanvas, targetBytes),
      canvasBlob(maskCanvas)
    ]);
    if (imageBlob.size <= targetBytes && maskBlob.size <= targetBytes) {
      return {
        imageBlob,
        maskBlob,
        width: layout.width,
        height: layout.height,
        scale: layout.scale,
        tiles,
        sourceMasks
      };
    }

    const nextBudget = nextAutoLayerAtlasPixelBudget(
      layout.width * layout.height,
      imageBlob.size,
      maskBlob.size,
      maxBytes
    );
    imageCanvas.width = maskCanvas.width = 1;
    imageCanvas.height = maskCanvas.height = 1;
    if (nextBudget >= pixelBudget) break;
    pixelBudget = nextBudget;
  }

  throw new Error("自动分层图集编码后仍超过云端大小限制，请缩小原图后重试。");
}

export interface AutoLayerRepairAtlasSet {
  /** 整页背景图集；未拆分时包含整页背景与全部父素材裁片。 */
  atlas: AutoLayerRepairAtlas;
  /** 拆分时仅父素材的图集，与 atlas 各走一个独立云端任务。 */
  splitAtlas: AutoLayerRepairAtlas | null;
}

/**
 * 先尝试单张图集；整页背景与父素材裁片统一缩放低于阈值（或单图编码失败）
 * 时拆分为「整页背景」与「父素材」两张图集，各走一个独立云端任务，
 * 让每张在承载内保持尽量高的分辨率。
 */
export async function createAutoLayerRepairAtlasSet(
  options: AutoLayerRepairAtlasOptions
): Promise<AutoLayerRepairAtlasSet> {
  let single: AutoLayerRepairAtlas | null = null;
  try {
    single = await createAutoLayerRepairAtlas(options);
  } catch {
    single = null;
  }
  if (single && !shouldSplitAutoLayerAtlas(single.scale, options.regions.length > 0)) {
    return { atlas: single, splitAtlas: null };
  }
  if (!options.regions.length) {
    if (single) return { atlas: single, splitAtlas: null };
    throw new Error("云端背景图集超出单次修复容量，请缩小原图后重试。");
  }
  const [backgroundAtlas, materialsAtlas] = await Promise.all([
    createAutoLayerRepairAtlas({ ...options, regions: [], includeBackground: true }),
    createAutoLayerRepairAtlas({ ...options, includeBackground: false })
  ]);
  return { atlas: backgroundAtlas, splitAtlas: materialsAtlas };
}

async function drawAtlasTile(
  bitmap: ImageBitmap,
  tile: AutoLayerRepairAtlasTile,
  width: number,
  height: number,
  smoothing = true
) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法拆分云端背景图集。");
  const box = tile.contentAtlasBox;
  context.imageSmoothingEnabled = smoothing;
  if (smoothing) context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function replaceAutoLayerTileRgb(
  source: Uint8ClampedArray,
  repaired: Uint8ClampedArray
) {
  if (source.length !== repaired.length || source.length % 4 !== 0) {
    throw new Error("云端背景图集像素尺寸无效。");
  }
  const output = source.slice();
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = repaired[offset];
    output[offset + 1] = repaired[offset + 1];
    output[offset + 2] = repaired[offset + 2];
  }
  return output;
}

function validateSourceMask(mask: AutoLayerRepairSourceMask, width: number, height: number) {
  if (mask.width !== width || mask.height !== height || mask.values.length !== width * height) {
    throw new Error("云端背景原始蒙版尺寸无效。");
  }
}

async function applyAtlasTileRgb(
  repairedBitmap: ImageBitmap,
  tile: AutoLayerRepairAtlasTile,
  sourceBlob: Blob,
  width: number,
  height: number
) {
  const [sourceBitmap, repairedCanvas] = await Promise.all([
    createImageBitmap(sourceBlob),
    drawAtlasTile(repairedBitmap, tile, width, height)
  ]);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const repairedContext = repairedCanvas.getContext("2d", { willReadFrequently: true });
    if (!context || !repairedContext) {
      throw new Error("当前设备无法合成云端背景图集。");
    }
    context.drawImage(sourceBitmap, 0, 0, canvas.width, canvas.height);
    const sourcePixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const repairedPixels = repairedContext.getImageData(0, 0, canvas.width, canvas.height);
    sourcePixels.data.set(replaceAutoLayerTileRgb(sourcePixels.data, repairedPixels.data));
    context.putImageData(sourcePixels, 0, 0);
    return canvasBlob(canvas);
  } finally {
    sourceBitmap.close();
  }
}

export async function applyAutoLayerRepairAtlas(
  outputBlob: Blob,
  atlas: AutoLayerRepairAtlas,
  source: AutoLayerRepairAtlasSource
): Promise<AutoLayerRepairAtlasResult> {
  const bitmap = await createImageBitmap(outputBlob);
  try {
    const backgroundTile = atlas.tiles.find(tile => tile.kind === "background");
    const backgroundMask = atlas.sourceMasks.find(mask => mask.kind === "background");
    // 拆分模式下父素材图集不含整页背景瓦片，原样保留背景。
    let backgroundBlob = source.backgroundBlob;
    if (backgroundTile || backgroundMask) {
      if (!backgroundTile || !backgroundMask) throw new Error("云端背景图集缺少整页背景。");
      validateSourceMask(backgroundMask, backgroundTile.sourceBox.width, backgroundTile.sourceBox.height);
      backgroundBlob = await applyAtlasTileRgb(
        bitmap,
        backgroundTile,
        source.backgroundBlob,
        backgroundTile.sourceBox.width,
        backgroundTile.sourceBox.height
      );
    }
    const materialTiles = new Map(atlas.tiles
      .filter(tile => tile.kind === "material" && tile.layerId)
      .map(tile => [tile.layerId!, tile]));
    const nextLayers = await Promise.all(source.layers.map(async layer => {
      if (layer.kind !== "material") return layer;
      const tile = materialTiles.get(layer.id);
      const sourceMask = atlas.sourceMasks.find(mask => mask.kind === "material" && mask.layerId === layer.id);
      if (!tile) return layer;
      if (!sourceMask) throw new Error(`云端背景图集缺少图层 ${layer.name} 的原始蒙版。`);
      validateSourceMask(sourceMask, layer.width, layer.height);
      return {
        ...layer,
        blob: await applyAtlasTileRgb(
          bitmap,
          tile,
          layer.blob,
          layer.width,
          layer.height
        ),
        cleanedChildren: true
      };
    }));
    return { backgroundBlob, layers: nextLayers };
  } finally {
    bitmap.close();
  }
}
