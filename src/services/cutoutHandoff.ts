import type { SelectedImageFile } from "@/types";

/**
 * AI 抠图页面的图片交接载荷。
 * 与 imageEditorHandoff 一致：纯内存、一次性消费，刷新即丢失。
 */
export interface CutoutHandoff {
  selectedFile: SelectedImageFile;
}

let pendingHandoff: CutoutHandoff | null = null;

export function stageCutoutHandoff(handoff: CutoutHandoff): void {
  pendingHandoff = handoff;
}

export function consumeCutoutHandoff(): CutoutHandoff | null {
  const handoff = pendingHandoff;
  pendingHandoff = null;
  return handoff;
}
