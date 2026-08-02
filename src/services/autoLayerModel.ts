import type { AutoLayerMaterial } from "@/composables/useCutoutInference";
import type { AutoLayerItem, AutoLayerItemKind } from "@/components/auto-layer/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function createAutoLayerItems(materials: readonly AutoLayerMaterial[]): AutoLayerItem[] {
  return materials.map((material, index) => ({
    id: material.id,
    name: `图层 ${index + 1}`,
    kind: "material",
    blob: material.blob,
    sourceBox: { ...material.sourceBox },
    x: material.sourceBox.x,
    y: material.sourceBox.y,
    width: material.width,
    height: material.height,
    text: "输入文字",
    fontSize: Math.max(16, Math.round(material.height * 0.42)),
    color: "#f1f4f8",
    visible: true
  }));
}

export function moveAutoLayer(
  layer: AutoLayerItem,
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number
): AutoLayerItem {
  const minX = Math.min(0, canvasWidth - layer.width);
  const maxX = Math.max(0, canvasWidth - layer.width);
  const minY = Math.min(0, canvasHeight - layer.height);
  const maxY = Math.max(0, canvasHeight - layer.height);
  return {
    ...layer,
    x: clamp(x, minX, maxX),
    y: clamp(y, minY, maxY)
  };
}

export function scaleAutoLayer(
  layer: AutoLayerItem,
  scale: number,
  canvasWidth: number,
  canvasHeight: number
): AutoLayerItem {
  const resolvedScale = clamp(scale, 0.2, 4);
  const width = Math.max(8, layer.sourceBox.width * resolvedScale);
  const height = Math.max(8, layer.sourceBox.height * resolvedScale);
  return moveAutoLayer({ ...layer, width, height }, layer.x, layer.y, canvasWidth, canvasHeight);
}

export function setAutoLayerKind(layer: AutoLayerItem, kind: AutoLayerItemKind): AutoLayerItem {
  return {
    ...layer,
    kind,
    name: kind === "text" && layer.kind !== "text" ? `文字 ${layer.name.replace(/\D+/gu, "") || ""}`.trim() : layer.name
  };
}

export function resetAutoLayer(layer: AutoLayerItem): AutoLayerItem {
  return {
    ...layer,
    x: layer.sourceBox.x,
    y: layer.sourceBox.y,
    width: layer.sourceBox.width,
    height: layer.sourceBox.height
  };
}
