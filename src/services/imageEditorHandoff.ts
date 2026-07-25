import type { ImageEditorDocument } from "@/components/image-editor/types";
import type { SelectedImageFile } from "@/types";

export interface ImageEditorHandoff {
  selectedFile: SelectedImageFile;
  document?: ImageEditorDocument;
  applied?: {
    blob: Blob;
    width: number;
    height: number;
  };
  quality?: number;
}

let pendingHandoff: ImageEditorHandoff | null = null;

export function stageImageEditorHandoff(handoff: ImageEditorHandoff): void {
  pendingHandoff = handoff;
}

export function consumeImageEditorHandoff(): ImageEditorHandoff | null {
  const handoff = pendingHandoff;
  pendingHandoff = null;
  return handoff;
}
