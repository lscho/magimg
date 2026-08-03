import type { CutoutSelectionBox } from "@/types";

export type AutoLayerFontCategory = "sans" | "serif" | "rounded" | "display" | "calligraphic";
export type AutoLayerDocumentStatus = "draft" | "complete";

interface AutoLayerBaseItem {
  id: string;
  name: string;
  blob: Blob;
  sourceBox: CutoutSelectionBox;
  sourceSelectionId: string;
  parentId: string | null;
  recognitionConfidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface AutoLayerMaterialItem extends AutoLayerBaseItem {
  kind: "material";
  elementType: string;
  cleanedChildren: boolean;
}

export interface AutoLayerTextItem extends AutoLayerBaseItem {
  kind: "text";
  text: string;
  ocrConfidence: number;
  fontSize: number;
  fontWeight: number;
  fontCategory: AutoLayerFontCategory;
  color: string;
}

export type AutoLayerItem = AutoLayerMaterialItem | AutoLayerTextItem;

export interface AutoLayerDocument {
  backgroundBlob: Blob;
  width: number;
  height: number;
  layers: AutoLayerItem[];
  status: AutoLayerDocumentStatus;
  cloudInputAssetId?: string;
}

export interface AutoLayerManifestV1 {
  schemaVersion: 1;
  canvas: { width: number; height: number };
  background: "background.png";
  preview: "preview.png";
  layers: Array<{
    id: string;
    name: string;
    kind: AutoLayerItem["kind"];
    file: string;
    sourceSelectionId: string;
    parentId: string | null;
    visible: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}
