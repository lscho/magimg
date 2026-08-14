import type { Ref } from "vue";
import type { Canvas as FabricCanvas, FabricObject, PencilBrush } from "fabric/es";
import type { ImageAdjustments } from "./types";
import { drawAdjustedImage, hasImageAdjustments } from "./imageAdjustments";

interface ViewportControllerOptions {
  canvas: () => FabricCanvas | null;
  baseCanvas: () => HTMLCanvasElement | null;
  viewport: () => HTMLElement | null;
  imageSource: () => CanvasImageSource | null;
  outputWidth: Ref<number>;
  outputHeight: Ref<number>;
  previewWidth: Ref<number>;
  previewHeight: Ref<number>;
  previewScale: Ref<number>;
  zoomPercent: Ref<number>;
  panX: Ref<number>;
  panY: Ref<number>;
  panning: Ref<boolean>;
  ready: Ref<boolean>;
  busy: Ref<boolean>;
  activeTool: Ref<string>;
  adjustments: ImageAdjustments;
  annotationObjects: () => FabricObject[];
  prepareAnnotationObject: (object: FabricObject) => void;
  createBrush: (eraser: boolean) => PencilBrush;
  updateDrawingCursor: () => void;
  updateCropControlScale: () => void;
}

const MIN_ZOOM_PERCENT = 25;
const MAX_ZOOM_PERCENT = 400;
const ZOOM_BUTTON_STEP = 25;
const PAN_VIEWPORT_PADDING_PX = 16;
const PAN_MIN_VISIBLE_PX = 48;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function createImageEditorViewportController(options: ViewportControllerOptions) {
  let previewAdjustmentCanvas: HTMLCanvasElement | null = null;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;
  let canvasOffsetFrame: number | null = null;

  function panLimit(previewSize: number, viewportSize: number) {
    const innerSize = Math.max(1, viewportSize - PAN_VIEWPORT_PADDING_PX * 2);
    if (previewSize <= innerSize) {
      return Math.max(0, (viewportSize - previewSize) / 2 - PAN_VIEWPORT_PADDING_PX);
    }
    return Math.max(0, (previewSize - viewportSize) / 2 + PAN_MIN_VISIBLE_PX);
  }

  function constrainPan() {
    const viewport = options.viewport();
    if (!viewport) return;
    const limitX = panLimit(options.previewWidth.value, viewport.clientWidth);
    const limitY = panLimit(options.previewHeight.value, viewport.clientHeight);
    options.panX.value = clamp(options.panX.value, -limitX, limitX);
    options.panY.value = clamp(options.panY.value, -limitY, limitY);
  }

  function scheduleCanvasOffset() {
    if (canvasOffsetFrame !== null) cancelAnimationFrame(canvasOffsetFrame);
    canvasOffsetFrame = requestAnimationFrame(() => {
      canvasOffsetFrame = null;
      options.canvas()?.calcOffset();
    });
  }

  function resizePreview() {
    const viewport = options.viewport();
    const canvas = options.canvas();
    if (!viewport || !canvas || !options.baseCanvas()) return;
    const availableWidth = Math.max(120, viewport.clientWidth - 32);
    const availableHeight = Math.max(120, viewport.clientHeight - 32);
    const fitScale = Math.max(
      0.01,
      Math.min(
        availableWidth / options.outputWidth.value,
        availableHeight / options.outputHeight.value
      )
    );
    const scale = fitScale * options.zoomPercent.value / 100;
    options.previewScale.value = scale;
    options.previewWidth.value = Math.max(1, Math.floor(options.outputWidth.value * scale));
    options.previewHeight.value = Math.max(1, Math.floor(options.outputHeight.value * scale));

    canvas.setDimensions({
      width: options.previewWidth.value,
      height: options.previewHeight.value
    });
    canvas.setViewportTransform([scale, 0, 0, scale, 0, 0]);
    constrainPan();
    options.annotationObjects().forEach(options.prepareAnnotationObject);
    if (options.activeTool.value === "draw" || options.activeTool.value === "erase") {
      canvas.freeDrawingBrush = options.createBrush(options.activeTool.value === "erase");
      options.updateDrawingCursor();
    }
    options.updateCropControlScale();
    renderBasePreview();
    canvas.requestRenderAll();
    scheduleCanvasOffset();
  }

  function setZoom(nextPercent: number, anchor?: { clientX: number; clientY: number }) {
    const viewport = options.viewport();
    if (!viewport || !Number.isFinite(nextPercent)) return;
    const normalized = clamp(Math.round(nextPercent), MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT);
    const previous = options.zoomPercent.value;
    if (normalized === previous) return;

    if (anchor) {
      // 反向调整平移量，使滚轮指针下的图像点在缩放前后保持原位。
      const bounds = viewport.getBoundingClientRect();
      const anchorX = anchor.clientX - bounds.left - viewport.clientWidth / 2;
      const anchorY = anchor.clientY - bounds.top - viewport.clientHeight / 2;
      const ratio = normalized / previous;
      options.panX.value = anchorX - (anchorX - options.panX.value) * ratio;
      options.panY.value = anchorY - (anchorY - options.panY.value) * ratio;
    }

    options.zoomPercent.value = normalized;
    resizePreview();
  }

  function zoomIn() {
    setZoom(options.zoomPercent.value + ZOOM_BUTTON_STEP);
  }

  function zoomOut() {
    setZoom(options.zoomPercent.value - ZOOM_BUTTON_STEP);
  }

  function fitPreview() {
    options.zoomPercent.value = 100;
    options.panX.value = 0;
    options.panY.value = 0;
    resizePreview();
  }

  function zoomFromWheel(event: WheelEvent) {
    if (!options.ready.value || options.busy.value || !event.deltaY) return;
    const direction = event.deltaY < 0 ? 1 : -1;
    setZoom(options.zoomPercent.value + direction * 10, {
      clientX: event.clientX,
      clientY: event.clientY
    });
  }

  function startPan(clientX: number, clientY: number) {
    if (
      options.activeTool.value !== "pan" ||
      !options.ready.value ||
      options.busy.value
    ) {
      return false;
    }
    options.panning.value = true;
    panStartX = clientX;
    panStartY = clientY;
    panOriginX = options.panX.value;
    panOriginY = options.panY.value;
    options.updateDrawingCursor();
    return true;
  }

  function movePan(clientX: number, clientY: number) {
    if (!options.panning.value) return;
    options.panX.value = panOriginX + clientX - panStartX;
    options.panY.value = panOriginY + clientY - panStartY;
    constrainPan();
    scheduleCanvasOffset();
  }

  function endPan() {
    if (!options.panning.value) return;
    options.panning.value = false;
    options.updateDrawingCursor();
    scheduleCanvasOffset();
  }

  function renderBasePreview() {
    const baseCanvas = options.baseCanvas();
    const imageSource = options.imageSource();
    if (!baseCanvas || !imageSource) return;

    // 高 DPI 只提高预览清晰度；Fabric 和编辑文档始终使用原图坐标。
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    baseCanvas.width = Math.max(1, Math.floor(options.previewWidth.value * dpr));
    baseCanvas.height = Math.max(1, Math.floor(options.previewHeight.value * dpr));
    baseCanvas.style.width = `${options.previewWidth.value}px`;
    baseCanvas.style.height = `${options.previewHeight.value}px`;
    const context = baseCanvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!hasImageAdjustments(options.adjustments)) {
      context.drawImage(
        imageSource,
        0,
        0,
        options.previewWidth.value,
        options.previewHeight.value
      );
      return;
    }

    previewAdjustmentCanvas ??= document.createElement("canvas");
    previewAdjustmentCanvas.width = options.previewWidth.value;
    previewAdjustmentCanvas.height = options.previewHeight.value;
    const adjustmentContext = previewAdjustmentCanvas.getContext("2d");
    if (!adjustmentContext) return;
    drawAdjustedImage(
      adjustmentContext,
      imageSource,
      options.previewWidth.value,
      options.previewHeight.value,
      options.adjustments
    );
    context.drawImage(
      previewAdjustmentCanvas,
      0,
      0,
      options.previewWidth.value,
      options.previewHeight.value
    );
  }

  function dispose() {
    if (canvasOffsetFrame !== null) cancelAnimationFrame(canvasOffsetFrame);
    canvasOffsetFrame = null;
    if (previewAdjustmentCanvas) {
      previewAdjustmentCanvas.width = 0;
      previewAdjustmentCanvas.height = 0;
    }
    previewAdjustmentCanvas = null;
  }

  return {
    dispose,
    endPan,
    fitPreview,
    movePan,
    renderBasePreview,
    resizePreview,
    setZoom,
    startPan,
    zoomFromWheel,
    zoomIn,
    zoomOut
  };
}
