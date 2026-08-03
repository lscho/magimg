import type {
  AutoLayerDocument,
  AutoLayerItem,
  AutoLayerManifestV1,
  AutoLayerTextItem
} from "@/components/auto-layer/types";
import { saveProjectDirectory } from "@/services/desktop";
import { renderAutoLayerTextAsset } from "@/services/autoLayerRecognition";

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error("分层预览生成失败。")),
    "image/png"
  ));
}

async function drawBlob(context: CanvasRenderingContext2D, blob: Blob, layer?: AutoLayerItem) {
  const bitmap = await createImageBitmap(blob);
  try {
    if (layer) context.drawImage(bitmap, layer.x, layer.y, layer.width, layer.height);
    else context.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }
}

export async function renderAutoLayerPreview(document: AutoLayerDocument) {
  const canvas = window.document.createElement("canvas");
  canvas.width = document.width;
  canvas.height = document.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法合成分层预览。");
  await drawBlob(context, document.backgroundBlob);
  for (const layer of document.layers) {
    if (!layer.visible) continue;
    await drawBlob(context, await renderAutoLayerAsset(layer), layer);
  }
  return canvasBlob(canvas);
}

export function renderAutoLayerAsset(layer: AutoLayerItem) {
  if (layer.kind !== "text") return Promise.resolve(layer.blob);
  return renderAutoLayerTextAsset({
    text: layer.text,
    color: layer.color,
    fontSize: layer.fontSize,
    fontWeight: layer.fontWeight,
    fontCategory: layer.fontCategory,
    width: layer.sourceBox.width,
    height: layer.sourceBox.height
  });
}

function safeAssetName(layer: AutoLayerItem, used: Set<string>) {
  const base = layer.name.toLowerCase().replace(/[^a-z0-9-]+/gu, "-").replace(/^-+|-+$/gu, "") || layer.kind;
  let name = base;
  let suffix = 2;
  while (used.has(name)) name = `${base}-${suffix++}`;
  used.add(name);
  return name;
}

export function buildAutoLayerManifest(document: AutoLayerDocument, assetNames: ReadonlyMap<string, string>): AutoLayerManifestV1 {
  return {
    schemaVersion: 1,
    canvas: { width: document.width, height: document.height },
    background: "background.png",
    preview: "preview.png",
    layers: document.layers.map(layer => ({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      file: `assets/${assetNames.get(layer.id) ?? layer.id}.png`,
      sourceSelectionId: layer.sourceSelectionId,
      parentId: layer.parentId,
      visible: layer.visible,
      x: layer.x,
      y: layer.y,
      width: layer.width,
      height: layer.height
    }))
  };
}

function textRecord(layer: AutoLayerTextItem) {
  return {
    id: layer.id,
    name: layer.name,
    text: layer.text,
    confidence: layer.ocrConfidence,
    color: layer.color,
    fontSize: layer.fontSize,
    fontWeight: layer.fontWeight,
    fontCategory: layer.fontCategory,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height
  };
}

export async function saveAutoLayerPackage(document: AutoLayerDocument, sourceName: string) {
  if (document.status !== "complete") throw new Error("云端背景尚未完成，当前草稿不能打包保存。");
  const used = new Set<string>();
  const assetNames = new Map(document.layers.map(layer => [layer.id, safeAssetName(layer, used)]));
  const manifest = buildAutoLayerManifest(document, assetNames);
  const baseName = sourceName.replace(/\.[^.]+$/u, "") || "image";
  const layerAssets = await Promise.all(document.layers.map(async layer => ({
    relativePath: `assets/${assetNames.get(layer.id)}.png`,
    contents: await renderAutoLayerAsset(layer)
  })));
  return saveProjectDirectory(`${baseName}-layers`, [
    { relativePath: "preview.png", contents: await renderAutoLayerPreview(document) },
    { relativePath: "background.png", contents: document.backgroundBlob },
    ...layerAssets,
    {
      relativePath: "texts.json",
      contents: JSON.stringify(document.layers.filter((layer): layer is AutoLayerTextItem => layer.kind === "text").map(textRecord), null, 2)
    },
    { relativePath: "manifest.json", contents: JSON.stringify(manifest, null, 2) }
  ]);
}
