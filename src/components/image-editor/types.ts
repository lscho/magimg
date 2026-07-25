export type ImageEditorTool = "select" | "pan" | "crop" | "adjust" | "text" | "draw" | "erase";
export type CropRatio = "free" | "original" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
export type CropDimension = "width" | "height";
export type ImageAdjustment = "brightness" | "contrast" | "saturation" | "grayscale";

export interface ImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
}

export type ImageGeometryOperation =
  | { type: "rotate"; direction: "clockwise" | "counterclockwise" }
  | { type: "flip"; axis: "horizontal" | "vertical" }
  | { type: "crop"; x: number; y: number; width: number; height: number };

export interface ImageEditorDocument {
  version: 1;
  operations: ImageGeometryOperation[];
  adjustments: ImageAdjustments;
  annotations: Record<string, unknown>;
}

export interface ImageEditorSource {
  blob: Blob;
  mimeType: string;
  fileBaseName: string;
  quality?: number;
  document?: ImageEditorDocument;
}

export type ImageEditorApplyResult =
  | { pristine: true }
  | {
      pristine: false;
      blob: Blob;
      document: ImageEditorDocument;
      width: number;
      height: number;
      mimeType: string;
    };

export function createEmptyImageEditorDocument(): ImageEditorDocument {
  return {
    version: 1,
    operations: [],
    adjustments: {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      grayscale: 0
    },
    annotations: { objects: [] }
  };
}

export function isPristineImageEditorDocument(document: ImageEditorDocument): boolean {
  const annotations = Array.isArray(document.annotations.objects)
    ? document.annotations.objects
    : [];
  return (
    document.operations.length === 0 &&
    document.adjustments.brightness === 0 &&
    document.adjustments.contrast === 0 &&
    document.adjustments.saturation === 0 &&
    (document.adjustments.grayscale ?? 0) === 0 &&
    annotations.length === 0
  );
}
