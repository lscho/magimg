import type { Ref } from "vue";
import type {
  Canvas as FabricCanvas,
  FabricObject,
  Rect as FabricRect
} from "fabric/es";
import type { FabricRuntime } from "./fabricRuntime";
import type { CropDimension, CropRatio } from "./types";

interface CropControllerOptions {
  canvas: () => FabricCanvas | null;
  runtime: () => FabricRuntime | null;
  transientObjects: Set<FabricObject>;
  outputWidth: Ref<number>;
  outputHeight: Ref<number>;
  previewScale: Ref<number>;
  cropRatio: Ref<CropRatio>;
  cropWidth: Ref<number>;
  cropHeight: Ref<number>;
  isActive: () => boolean;
}

export interface CropSelectionBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CROP_EDGE_TOLERANCE_PX = 4;
const CROP_HANDLE_INSET_PX = 7;
const CROP_OUTLINE_WIDTH_PX = 2;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createImageEditorCropController(options: CropControllerOptions) {
  let cropBox: FabricRect | null = null;
  let cropShade: FabricRect | null = null;
  let cropShadeClip: FabricRect | null = null;
  let cropOutline: FabricRect | null = null;

  function ratioValue(ratio: CropRatio) {
    if (ratio === "free") return null;
    if (ratio === "original") return options.outputWidth.value / options.outputHeight.value;
    const [width, height] = ratio.split(":").map(Number);
    return width / height;
  }

  function setRatio(ratio: CropRatio) {
    options.cropRatio.value = ratio;
    if (options.isActive()) createOverlay();
  }

  function clearOverlay() {
    const canvas = options.canvas();
    if (!canvas) return;
    const overlayObjects = [cropShade, cropOutline, cropBox].filter(
      (object): object is FabricRect => object !== null
    );
    const activeObject = canvas.getActiveObject();
    if (activeObject && overlayObjects.some((object) => object === activeObject)) {
      canvas.discardActiveObject();
    }
    overlayObjects.forEach((object) => {
      canvas.remove(object);
      options.transientObjects.delete(object);
    });
    if (cropShade) cropShade.clipPath = undefined;
    cropShade = null;
    cropShadeClip = null;
    cropOutline = null;
    cropBox = null;
    options.cropWidth.value = 0;
    options.cropHeight.value = 0;
    canvas.uniformScaling = false;
    canvas.requestRenderAll();
  }

  function createOverlay() {
    const canvas = options.canvas();
    const runtime = options.runtime();
    if (!canvas || !runtime) return;
    clearOverlay();
    canvas.discardActiveObject();
    canvas.uniformScaling = options.cropRatio.value !== "free";

    const inset = 0.06;
    const maxWidth = options.outputWidth.value * (1 - inset * 2);
    const maxHeight = options.outputHeight.value * (1 - inset * 2);
    const ratio = ratioValue(options.cropRatio.value);
    let width = maxWidth;
    let height = maxHeight;
    if (ratio) {
      if (width / height > ratio) width = height * ratio;
      else height = width / ratio;
    }

    const left = (options.outputWidth.value - width) / 2;
    const top = (options.outputHeight.value - height) / 2;
    cropShadeClip = new runtime.Rect({
      absolutePositioned: true,
      evented: false,
      excludeFromExport: true,
      fill: "#000000",
      height,
      inverted: true,
      left,
      originX: "left",
      originY: "top",
      selectable: false,
      strokeWidth: 0,
      top,
      width
    });
    cropShade = new runtime.Rect({
      evented: false,
      excludeFromExport: true,
      fill: "rgba(4, 7, 11, 0.62)",
      height: options.outputHeight.value,
      left: 0,
      originX: "left",
      originY: "top",
      selectable: false,
      strokeWidth: 0,
      top: 0,
      width: options.outputWidth.value,
      clipPath: cropShadeClip
    });
    cropOutline = new runtime.Rect({
      evented: false,
      excludeFromExport: true,
      fill: "transparent",
      height,
      left,
      objectCaching: false,
      originX: "left",
      originY: "top",
      selectable: false,
      stroke: "rgba(241, 244, 248, 0.94)",
      strokeWidth: 0,
      top,
      width
    });
    cropBox = new runtime.Rect({
      borderColor: "transparent",
      cornerColor: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      cornerSize: 11,
      cornerStrokeColor: "rgba(4, 7, 11, 0.82)",
      cornerStyle: "rect",
      evented: true,
      excludeFromExport: true,
      fill: "rgba(255, 255, 255, 0.001)",
      hasBorders: false,
      hasRotatingPoint: false,
      left,
      lockRotation: true,
      lockScalingFlip: true,
      originX: "left",
      originY: "top",
      padding: 0,
      selectable: true,
      strokeWidth: 0,
      top,
      transparentCorners: false,
      width,
      height
    });
    cropBox.setControlsVisibility({ mtr: false });
    if (ratio) cropBox.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
    cropBox.on("moving", constrainDuringTransform);
    cropBox.on("scaling", constrainDuringTransform);
    cropBox.on("modified", finalizeTransform);
    [cropShade, cropOutline, cropBox].forEach((object) => options.transientObjects.add(object));
    canvas.add(cropShade, cropOutline, cropBox);
    canvas.setActiveObject(cropBox);
    updateControlScale();
    syncOverlay();
    canvas.requestRenderAll();
  }

  function selectionBounds(): CropSelectionBounds {
    if (!cropBox) return { left: 0, top: 0, width: 0, height: 0 };
    return {
      left: cropBox.left,
      top: cropBox.top,
      width: Math.abs(cropBox.width * cropBox.scaleX),
      height: Math.abs(cropBox.height * cropBox.scaleY)
    };
  }

  function constrainBox(tolerance: number) {
    if (!cropBox) return;
    const ratio = ratioValue(options.cropRatio.value);
    const maxWidth = options.outputWidth.value + tolerance * 2;
    const maxHeight = options.outputHeight.value + tolerance * 2;
    let { width: scaledWidth, height: scaledHeight } = selectionBounds();
    if (ratio && (scaledWidth > maxWidth || scaledHeight > maxHeight)) {
      const factor = Math.min(maxWidth / scaledWidth, maxHeight / scaledHeight);
      cropBox.scaleX *= factor;
      cropBox.scaleY *= factor;
      ({ width: scaledWidth, height: scaledHeight } = selectionBounds());
    } else if (!ratio) {
      if (scaledWidth > maxWidth) cropBox.scaleX *= maxWidth / scaledWidth;
      if (scaledHeight > maxHeight) cropBox.scaleY *= maxHeight / scaledHeight;
      ({ width: scaledWidth, height: scaledHeight } = selectionBounds());
    }
    cropBox.left = clamp(
      cropBox.left,
      -tolerance,
      options.outputWidth.value - scaledWidth + tolerance
    );
    cropBox.top = clamp(
      cropBox.top,
      -tolerance,
      options.outputHeight.value - scaledHeight + tolerance
    );
  }

  function constrainDuringTransform() {
    const tolerance = CROP_EDGE_TOLERANCE_PX / Math.max(options.previewScale.value, 0.01);
    constrainBox(tolerance);
    syncOverlay();
  }

  function finalizeTransform() {
    if (!cropBox) return;
    constrainBox(0);
    cropBox.setCoords();
    syncOverlay();
  }

  function normalizedSelection() {
    const bounds = selectionBounds();
    const left = clamp(Math.round(bounds.left), 0, Math.max(0, options.outputWidth.value - 1));
    const top = clamp(Math.round(bounds.top), 0, Math.max(0, options.outputHeight.value - 1));
    return {
      left,
      top,
      width: clamp(Math.round(bounds.width), 1, options.outputWidth.value - left),
      height: clamp(Math.round(bounds.height), 1, options.outputHeight.value - top)
    };
  }

  function syncSelectionSize() {
    if (!cropBox) {
      options.cropWidth.value = 0;
      options.cropHeight.value = 0;
      return;
    }
    const bounds = normalizedSelection();
    options.cropWidth.value = bounds.width;
    options.cropHeight.value = bounds.height;
  }

  function setDimension(dimension: CropDimension, value: number) {
    const canvas = options.canvas();
    if (!cropBox || !canvas || !Number.isFinite(value)) return;
    const bounds = selectionBounds();
    const width = dimension === "width"
      ? clamp(Math.round(value), 1, options.outputWidth.value)
      : clamp(bounds.width, 1, options.outputWidth.value);
    const height = dimension === "height"
      ? clamp(Math.round(value), 1, options.outputHeight.value)
      : clamp(bounds.height, 1, options.outputHeight.value);
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;

    options.cropRatio.value = "free";
    canvas.uniformScaling = false;
    cropBox.setControlsVisibility({ ml: true, mr: true, mt: true, mb: true, mtr: false });
    cropBox.set({
      left: centerX - width / 2,
      top: centerY - height / 2,
      scaleX: width / Math.max(cropBox.width, 1),
      scaleY: height / Math.max(cropBox.height, 1)
    });
    constrainBox(0);
    updateControlScale();
    syncOverlay();
  }

  function updateControlScale() {
    if (!cropBox) return;
    cropBox.set({ cornerSize: 11, padding: 0 });
    const inset = CROP_HANDLE_INSET_PX;
    const controlOffsets: Record<string, readonly [number, number]> = {
      tl: [inset, inset], mt: [0, inset], tr: [-inset, inset], ml: [inset, 0],
      mr: [-inset, 0], bl: [inset, -inset], mb: [0, -inset], br: [-inset, -inset]
    };
    Object.entries(controlOffsets).forEach(([key, [offsetX, offsetY]]) => {
      const control = cropBox?.controls[key];
      if (!control) return;
      control.offsetX = offsetX;
      control.offsetY = offsetY;
    });
    cropBox.setCoords();
    syncOverlay();
  }

  function syncOverlay() {
    const canvas = options.canvas();
    if (!cropBox || !cropShade || !cropShadeClip || !cropOutline) return;
    const bounds = selectionBounds();
    const left = clamp(bounds.left, 0, options.outputWidth.value);
    const top = clamp(bounds.top, 0, options.outputHeight.value);
    const right = clamp(bounds.left + bounds.width, 0, options.outputWidth.value);
    const bottom = clamp(bounds.top + bounds.height, 0, options.outputHeight.value);
    cropShadeClip.set({
      height: Math.max(1, bottom - top),
      left,
      scaleX: 1,
      scaleY: 1,
      top,
      width: Math.max(1, right - left)
    });
    cropShadeClip.dirty = true;
    cropShade.dirty = true;

    // Fabric 对象使用原图坐标；描边宽度需除以预览缩放，才能保持固定屏幕像素。
    const scale = Math.max(options.previewScale.value, 0.01);
    const strokeWidth = CROP_OUTLINE_WIDTH_PX / scale;
    const inset = (CROP_OUTLINE_WIDTH_PX / 2 + 0.5) / scale;
    cropOutline.set({
      height: Math.max(0, bottom - top - inset * 2),
      left: left + inset,
      scaleX: 1,
      scaleY: 1,
      strokeWidth,
      top: top + inset,
      width: Math.max(0, right - left - inset * 2)
    });
    cropOutline.dirty = true;
    syncSelectionSize();
    canvas?.requestRenderAll();
  }

  function prepareSelection() {
    if (!cropBox) return null;
    constrainBox(0);
    cropBox.setCoords();
    syncOverlay();
    return normalizedSelection();
  }

  return {
    clearOverlay,
    createOverlay,
    prepareSelection,
    setDimension,
    setRatio,
    updateControlScale
  };
}
