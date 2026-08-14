import { cutoutSelectionBounds, type CutoutPixelBounds } from "@/services/cutoutGeometry";
import type { CutoutSelectionBox } from "@/types";

export interface CutoutRepairInputRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CutoutRepairLayout {
  bounds: CutoutPixelBounds;
  inputRect: CutoutRepairInputRect;
}

export interface CutoutRepairModelMapping {
  sourceRect: CutoutRepairInputRect;
  targetRect: CutoutRepairInputRect;
}

export function buildCutoutRepairLayoutFromBounds(
  bounds: CutoutPixelBounds,
  inputWidth: number,
  inputHeight: number
): CutoutRepairLayout {
  const scale = Math.min(inputWidth / bounds.width, inputHeight / bounds.height);
  const width = Math.min(inputWidth, Math.max(1, Math.round(bounds.width * scale)));
  const height = Math.min(inputHeight, Math.max(1, Math.round(bounds.height * scale)));
  return {
    bounds: { ...bounds },
    inputRect: {
      x: Math.floor((inputWidth - width) / 2),
      y: Math.floor((inputHeight - height) / 2),
      width,
      height
    }
  };
}

/** 将当前选框等比放入模型输入，输入上下文严格来自选框内部。 */
export function buildCutoutRepairLayout(
  box: CutoutSelectionBox,
  imageWidth: number,
  imageHeight: number,
  inputWidth: number,
  inputHeight: number
): CutoutRepairLayout {
  const bounds = cutoutSelectionBounds(imageWidth, imageHeight, box);
  return buildCutoutRepairLayoutFromBounds(bounds, inputWidth, inputHeight);
}

/** 单框修复从完整素材上下文取样，再等比放入模型输入的居中目标区。 */
export function buildCutoutRepairModelMapping(
  layout: CutoutRepairLayout
): CutoutRepairModelMapping {
  return {
    sourceRect: {
      x: 0,
      y: 0,
      width: layout.bounds.width,
      height: layout.bounds.height
    },
    targetRect: { ...layout.inputRect }
  };
}
