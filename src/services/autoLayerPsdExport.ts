import { writePsd, type Layer, type PixelData, type Psd } from "ag-psd";
import type {
  AutoLayerDocument,
  AutoLayerFontCategory,
  AutoLayerItem,
  AutoLayerTextItem
} from "@/components/auto-layer/types";
import { renderAutoLayerAsset, renderAutoLayerPreview } from "@/services/autoLayerExport";

function outputSize(value: number) {
  return Math.max(1, Math.round(value));
}

async function rasterizeBlob(blob: Blob, width: number, height: number): Promise<PixelData> {
  const resolvedWidth = outputSize(width);
  const resolvedHeight = outputSize(height);
  const canvas = document.createElement("canvas");
  canvas.width = resolvedWidth;
  canvas.height = resolvedHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前设备无法生成 PSD 图层像素。");
  const bitmap = await createImageBitmap(blob);
  try {
    context.clearRect(0, 0, resolvedWidth, resolvedHeight);
    context.drawImage(bitmap, 0, 0, resolvedWidth, resolvedHeight);
    const imageData = context.getImageData(0, 0, resolvedWidth, resolvedHeight);
    return { data: imageData.data, width: resolvedWidth, height: resolvedHeight };
  } finally {
    bitmap.close();
  }
}

function parseHexColor(value: string) {
  const match = /^#([0-9a-f]{6})$/iu.exec(value.trim());
  if (!match) return { r: 255, g: 255, b: 255 };
  return {
    r: Number.parseInt(match[1].slice(0, 2), 16),
    g: Number.parseInt(match[1].slice(2, 4), 16),
    b: Number.parseInt(match[1].slice(4, 6), 16)
  };
}

function psdFontName(category: AutoLayerFontCategory, bold: boolean) {
  const fonts: Record<AutoLayerFontCategory, [regular: string, bold: string]> = {
    sans: ["MicrosoftYaHei", "MicrosoftYaHei-Bold"],
    serif: ["SimSun", "SimHei"],
    rounded: ["ArialRoundedMTBold", "ArialRoundedMTBold"],
    display: ["Impact", "Impact"],
    calligraphic: ["KaiTi", "KaiTi"]
  };
  return fonts[category][bold ? 1 : 0];
}

function textData(layer: AutoLayerTextItem) {
  const width = outputSize(layer.width);
  const height = outputSize(layer.height);
  const scaleY = height / Math.max(1, layer.sourceBox.height);
  const bold = layer.fontWeight >= 600;
  return {
    text: layer.text,
    transform: [1, 0, 0, 1, Math.round(layer.x), Math.round(layer.y)],
    antiAlias: "smooth" as const,
    shapeType: "box" as const,
    boxBounds: [0, 0, width, height],
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    style: {
      font: { name: psdFontName(layer.fontCategory, bold) },
      fontSize: Math.max(1, layer.fontSize * scaleY),
      fauxBold: bold,
      fillColor: parseHexColor(layer.color)
    },
    paragraphStyle: { justification: "center" as const }
  };
}

async function createPsdLayer(layer: AutoLayerItem): Promise<Layer> {
  const imageData = await rasterizeBlob(await renderAutoLayerAsset(layer), layer.width, layer.height);
  return {
    name: layer.name,
    left: Math.round(layer.x),
    top: Math.round(layer.y),
    right: Math.round(layer.x) + imageData.width,
    bottom: Math.round(layer.y) + imageData.height,
    hidden: !layer.visible,
    imageData,
    ...(layer.kind === "text" ? { text: textData(layer) } : {})
  };
}

/** Keeps application bottom-to-top order for ag-psd's writer record order. */
export function buildAutoLayerPsdTree(
  layers: readonly AutoLayerItem[],
  prepared: ReadonlyMap<string, Layer>
): Layer[] {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const childrenByParent = new Map<string, AutoLayerItem[]>();
  const roots: AutoLayerItem[] = [];
  for (const layer of layers) {
    if (layer.parentId && layer.parentId !== layer.id && byId.has(layer.parentId)) {
      const children = childrenByParent.get(layer.parentId) ?? [];
      children.push(layer);
      childrenByParent.set(layer.parentId, children);
    } else {
      roots.push(layer);
    }
  }

  const build = (layer: AutoLayerItem, ancestors: ReadonlySet<string>): Layer => {
    const content = prepared.get(layer.id);
    if (!content) throw new Error(`PSD 图层 ${layer.name} 的像素不存在。`);
    if (ancestors.has(layer.id)) return content;
    const children = childrenByParent.get(layer.id) ?? [];
    if (!children.length) return content;
    const nextAncestors = new Set(ancestors).add(layer.id);
    const childLayers = children.map(child => build(child, nextAncestors));
    return {
      name: layer.name,
      opened: true,
      children: [
        { ...content, name: `${layer.name} · ${layer.kind === "text" ? "文字" : "素材"}` },
        ...childLayers
      ]
    };
  };

  return roots.map(layer => build(layer, new Set()));
}

/**
 * ag-psd 31 writes children in Photoshop's bottom-to-top record order even
 * though its read API returns the same array as top-to-bottom.
 */
export function buildAutoLayerPsdRootLayers(
  layers: readonly AutoLayerItem[],
  prepared: ReadonlyMap<string, Layer>,
  background: Layer
): Layer[] {
  return [background, ...buildAutoLayerPsdTree(layers, prepared)];
}

export async function exportAutoLayerPsd(document: AutoLayerDocument) {
  if (document.status !== "complete") throw new Error("分层结果尚未完成，当前不能下载 PSD。");
  if (document.width > 30_000 || document.height > 30_000) {
    throw new Error("画布尺寸超过 PSD 的 30,000 像素限制。");
  }
  const preparedEntries = await Promise.all(document.layers.map(async layer => [
    layer.id,
    await createPsdLayer(layer)
  ] as const));
  const prepared = new Map(preparedEntries);
  const background = await rasterizeBlob(document.backgroundBlob, document.width, document.height);
  const composite = await rasterizeBlob(await renderAutoLayerPreview(document), document.width, document.height);
  const psd: Psd = {
    width: document.width,
    height: document.height,
    imageData: composite,
    children: buildAutoLayerPsdRootLayers(document.layers, prepared, {
      name: "背景",
      left: 0,
      top: 0,
      right: document.width,
      bottom: document.height,
      imageData: background
    })
  };
  const buffer = writePsd(psd, { noBackground: true });
  return new Blob([buffer], { type: "image/vnd.adobe.photoshop" });
}
