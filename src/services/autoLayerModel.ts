import type { AutoLayerMaterial } from "@/composables/useCutoutInference";
import type {
  AutoLayerItem,
  AutoLayerMaterialItem,
  AutoLayerTextItem
} from "@/components/auto-layer/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function createAutoLayerItems(materials: readonly AutoLayerMaterial[]): AutoLayerItem[] {
  return materials.map((material) => ({
    id: material.id,
    name: material.name ?? "element",
    kind: "material",
    blob: material.blob,
    sourceBox: { ...material.sourceBox },
    sourceSelectionId: material.sourceSelectionId ?? material.id,
    parentId: material.parentId ?? null,
    recognitionConfidence: material.classificationConfidence ?? 0,
    elementType: material.elementType ?? "element",
    cleanedChildren: material.cleanedChildren ?? false,
    x: material.sourceBox.x,
    y: material.sourceBox.y,
    width: material.width,
    height: material.height,
    visible: true
  } satisfies AutoLayerMaterialItem));
}

/** Stable parent-first order: every background material is rendered below its descendants. */
export function orderAutoLayersByHierarchy(layers: readonly AutoLayerItem[]): AutoLayerItem[] {
  const byId = new Map(layers.map(layer => [layer.id, layer]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: AutoLayerItem[] = [];

  function visit(layer: AutoLayerItem) {
    if (visited.has(layer.id)) return;
    if (visiting.has(layer.id)) {
      visited.add(layer.id);
      ordered.push(layer);
      return;
    }
    visiting.add(layer.id);
    const parent = layer.parentId ? byId.get(layer.parentId) : undefined;
    if (parent) visit(parent);
    visiting.delete(layer.id);
    if (visited.has(layer.id)) return;
    visited.add(layer.id);
    ordered.push(layer);
  }

  for (const layer of layers) visit(layer);
  return ordered;
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
  return { ...layer, x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
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

export function materialToText(layer: AutoLayerMaterialItem): AutoLayerTextItem {
  return {
    ...layer,
    kind: "text",
    name: layer.name.replace(/(?:-bg)?$/u, "-text"),
    text: "输入文字",
    ocrConfidence: 0,
    fontSize: Math.max(16, Math.round(layer.height * 0.42)),
    fontWeight: 500,
    fontCategory: "sans",
    color: "#f1f4f8"
  };
}

export function textToMaterial(layer: AutoLayerTextItem): AutoLayerMaterialItem {
  const { text: _text, ocrConfidence: _ocr, fontSize: _size, fontWeight: _weight,
    fontCategory: _font, color: _color, ...base } = layer;
  return {
    ...base,
    kind: "material",
    elementType: "element",
    cleanedChildren: false
  };
}

export function setAutoLayerKind(layer: AutoLayerItem, kind: "text"): AutoLayerTextItem;
export function setAutoLayerKind(layer: AutoLayerItem, kind: "material"): AutoLayerMaterialItem;
export function setAutoLayerKind(layer: AutoLayerItem, kind: AutoLayerItem["kind"]): AutoLayerItem {
  if (layer.kind === kind) return layer;
  return layer.kind === "material" ? materialToText(layer) : textToMaterial(layer);
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
