import type { CutoutSelectionBox } from "@/types";

export type AutoLayerItemKind = "material" | "text";

export interface AutoLayerItem {
  id: string;
  name: string;
  kind: AutoLayerItemKind;
  blob: Blob;
  sourceBox: CutoutSelectionBox;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  color: string;
  visible: boolean;
}

export interface AutoLayerDocument {
  backgroundBlob: Blob;
  width: number;
  height: number;
  layers: AutoLayerItem[];
}
