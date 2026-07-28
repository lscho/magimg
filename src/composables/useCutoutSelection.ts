import {
  computed,
  onBeforeUnmount,
  readonly,
  shallowRef
} from "vue";
import type { CutoutSelectionBox } from "@/types";

interface CutoutCanvasElements {
  baseCanvas: HTMLCanvasElement;
  viewport: HTMLElement;
}

export type CutoutTool = "box" | "pan";

const MIN_ZOOM_PERCENT = 25;
const MAX_ZOOM_PERCENT = 400;
const ZOOM_BUTTON_STEP = 25;
const PAN_VIEWPORT_PADDING_PX = 16;
const PAN_MIN_VISIBLE_PX = 48;

let selectionIdCounter = 0;

function nextSelectionId() {
  selectionIdCounter += 1;
  return `cutout-sel-${Date.now()}-${selectionIdCounter}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function cloneSelections(selections: CutoutSelectionBox[]) {
  return selections.map((selection) => ({ ...selection }));
}

/**
 * 管理抠图画布的图片预览、缩放、拖动与矩形选区。
 * 选框使用原生 pointer 事件和 DOM 覆盖层，坐标始终保存为原图像素。
 */
export function useCutoutSelection(
  imageSource: { blob: Blob; mimeType: string } | null,
  initialSelections: CutoutSelectionBox[] = []
) {
  const ready = shallowRef(false);
  const busy = shallowRef(false);
  const error = shallowRef("");
  const activeTool = shallowRef<CutoutTool>("box");
  const imageWidth = shallowRef(1);
  const imageHeight = shallowRef(1);
  const previewWidth = shallowRef(1);
  const previewHeight = shallowRef(1);
  const previewScale = shallowRef(1);
  const zoomPercent = shallowRef(100);
  const panX = shallowRef(0);
  const panY = shallowRef(0);
  const panning = shallowRef(false);
  const initialSelectionSnapshot = cloneSelections(initialSelections);
  const selections = shallowRef<CutoutSelectionBox[]>(initialSelectionSnapshot);
  const draftBox = shallowRef<CutoutSelectionBox | null>(null);
  const history = shallowRef<CutoutSelectionBox[][]>([
    cloneSelections(initialSelectionSnapshot)
  ]);
  const historyIndex = shallowRef(0);

  let baseCanvas: HTMLCanvasElement | null = null;
  let viewport: HTMLElement | null = null;
  let sourceBitmap: ImageBitmap | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let drawingOrigin: { x: number; y: number } | null = null;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;

  const canClear = computed(() => selections.value.length > 0);
  const canUndo = computed(() => historyIndex.value > 0);
  const canRedo = computed(() => historyIndex.value < history.value.length - 1);

  async function initialize(elements: CutoutCanvasElements) {
    baseCanvas = elements.baseCanvas;
    viewport = elements.viewport;
    resizeObserver = new ResizeObserver(() => resizePreview());
    resizeObserver.observe(elements.viewport);
    if (!imageSource) return;

    busy.value = true;
    error.value = "";
    try {
      sourceBitmap = await createImageBitmap(imageSource.blob);
      imageWidth.value = sourceBitmap.width;
      imageHeight.value = sourceBitmap.height;
      ready.value = true;
      resizePreview();
    } catch (exception) {
      error.value = exception instanceof Error ? exception.message : "抠图画布加载失败。";
    } finally {
      busy.value = false;
    }
  }

  function panLimit(previewSize: number, viewportSize: number) {
    const innerSize = Math.max(1, viewportSize - PAN_VIEWPORT_PADDING_PX * 2);
    if (previewSize <= innerSize) {
      return Math.max(0, (viewportSize - previewSize) / 2 - PAN_VIEWPORT_PADDING_PX);
    }
    return Math.max(0, (previewSize - viewportSize) / 2 + PAN_MIN_VISIBLE_PX);
  }

  function constrainPan() {
    if (!viewport || !ready.value) return;
    const limitX = panLimit(previewWidth.value, viewport.clientWidth);
    const limitY = panLimit(previewHeight.value, viewport.clientHeight);
    panX.value = clamp(panX.value, -limitX, limitX);
    panY.value = clamp(panY.value, -limitY, limitY);
  }

  function resizePreview() {
    if (!viewport || !baseCanvas || !sourceBitmap || !ready.value) return;
    const availableWidth = Math.max(120, viewport.clientWidth - 32);
    const availableHeight = Math.max(120, viewport.clientHeight - 32);
    const fitScale = Math.max(
      0.01,
      Math.min(availableWidth / imageWidth.value, availableHeight / imageHeight.value)
    );
    const scale = fitScale * zoomPercent.value / 100;
    previewScale.value = scale;
    previewWidth.value = Math.max(1, Math.round(imageWidth.value * scale));
    previewHeight.value = Math.max(1, Math.round(imageHeight.value * scale));
    constrainPan();
    renderBasePreview();
  }

  function renderBasePreview() {
    if (!baseCanvas || !sourceBitmap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    baseCanvas.width = Math.max(1, Math.round(previewWidth.value * dpr));
    baseCanvas.height = Math.max(1, Math.round(previewHeight.value * dpr));
    baseCanvas.style.width = `${previewWidth.value}px`;
    baseCanvas.style.height = `${previewHeight.value}px`;
    const context = baseCanvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.drawImage(sourceBitmap, 0, 0, previewWidth.value, previewHeight.value);
  }

  function setTool(tool: CutoutTool) {
    cancelBox();
    endPan();
    activeTool.value = tool;
  }

  function setZoom(nextPercent: number, anchor?: { clientX: number; clientY: number }) {
    if (!viewport || !ready.value || !Number.isFinite(nextPercent)) return;
    const normalized = clamp(Math.round(nextPercent), MIN_ZOOM_PERCENT, MAX_ZOOM_PERCENT);
    const previous = zoomPercent.value;
    if (normalized === previous) return;
    if (anchor) {
      const bounds = viewport.getBoundingClientRect();
      const anchorX = anchor.clientX - bounds.left - viewport.clientWidth / 2;
      const anchorY = anchor.clientY - bounds.top - viewport.clientHeight / 2;
      const ratio = normalized / previous;
      panX.value = anchorX - (anchorX - panX.value) * ratio;
      panY.value = anchorY - (anchorY - panY.value) * ratio;
    }
    zoomPercent.value = normalized;
    resizePreview();
  }

  function zoomIn() {
    setZoom(zoomPercent.value + ZOOM_BUTTON_STEP);
  }

  function zoomOut() {
    setZoom(zoomPercent.value - ZOOM_BUTTON_STEP);
  }

  function fitPreview() {
    zoomPercent.value = 100;
    panX.value = 0;
    panY.value = 0;
    resizePreview();
  }

  function zoomFromWheel(event: WheelEvent) {
    if (!ready.value || busy.value || !event.deltaY) return;
    setZoom(zoomPercent.value + (event.deltaY < 0 ? 10 : -10), {
      clientX: event.clientX,
      clientY: event.clientY
    });
  }

  function startPan(clientX: number, clientY: number): boolean {
    if (activeTool.value !== "pan" || !ready.value || busy.value) return false;
    panning.value = true;
    panStartX = clientX;
    panStartY = clientY;
    panOriginX = panX.value;
    panOriginY = panY.value;
    return true;
  }

  function movePan(clientX: number, clientY: number) {
    if (!panning.value) return;
    panX.value = panOriginX + clientX - panStartX;
    panY.value = panOriginY + clientY - panStartY;
    constrainPan();
  }

  function endPan() {
    panning.value = false;
  }

  function clientToImage(clientX: number, clientY: number) {
    if (!viewport) return { x: 0, y: 0, inside: false };
    const bounds = viewport.getBoundingClientRect();
    const left = bounds.left + bounds.width / 2 + panX.value - previewWidth.value / 2;
    const top = bounds.top + bounds.height / 2 + panY.value - previewHeight.value / 2;
    const localX = clientX - left;
    const localY = clientY - top;
    return {
      x: clamp(localX / Math.max(previewScale.value, 0.01), 0, imageWidth.value),
      y: clamp(localY / Math.max(previewScale.value, 0.01), 0, imageHeight.value),
      inside:
        localX >= 0 &&
        localY >= 0 &&
        localX <= previewWidth.value &&
        localY <= previewHeight.value
    };
  }

  function beginBoxFromClient(clientX: number, clientY: number): boolean {
    if (activeTool.value !== "box" || !ready.value || busy.value) return false;
    const point = clientToImage(clientX, clientY);
    if (!point.inside) return false;
    drawingOrigin = { x: point.x, y: point.y };
    draftBox.value = {
      id: "cutout-draft",
      x: point.x,
      y: point.y,
      width: 0,
      height: 0
    };
    return true;
  }

  function updateBoxFromClient(clientX: number, clientY: number) {
    if (!drawingOrigin) return;
    const point = clientToImage(clientX, clientY);
    draftBox.value = {
      id: "cutout-draft",
      x: Math.min(drawingOrigin.x, point.x),
      y: Math.min(drawingOrigin.y, point.y),
      width: Math.abs(point.x - drawingOrigin.x),
      height: Math.abs(point.y - drawingOrigin.y)
    };
  }

  function commitSelections(next: CutoutSelectionBox[]) {
    const snapshot = cloneSelections(next);
    selections.value = snapshot;
    history.value = [
      ...history.value.slice(0, historyIndex.value + 1),
      cloneSelections(snapshot)
    ];
    historyIndex.value += 1;
  }

  function finishBox() {
    const draft = draftBox.value;
    drawingOrigin = null;
    draftBox.value = null;
    if (!draft) return;
    const minSize = 4 / Math.max(previewScale.value, 0.01);
    if (draft.width < minSize || draft.height < minSize) return;

    const selection: CutoutSelectionBox = {
      id: nextSelectionId(),
      x: clamp(Math.round(draft.x), 0, imageWidth.value - 1),
      y: clamp(Math.round(draft.y), 0, imageHeight.value - 1),
      width: Math.max(1, Math.round(draft.width)),
      height: Math.max(1, Math.round(draft.height))
    };
    selection.width = Math.min(selection.width, imageWidth.value - selection.x);
    selection.height = Math.min(selection.height, imageHeight.value - selection.y);
    commitSelections([...selections.value, selection]);
  }

  function cancelBox() {
    drawingOrigin = null;
    draftBox.value = null;
  }

  function removeSelection(id: string) {
    const next = selections.value.filter((selection) => selection.id !== id);
    if (next.length === selections.value.length) return;
    commitSelections(next);
  }

  function clearSelections() {
    if (!selections.value.length) return;
    commitSelections([]);
  }

  function undo() {
    if (!canUndo.value) return;
    historyIndex.value -= 1;
    selections.value = cloneSelections(history.value[historyIndex.value]);
  }

  function redo() {
    if (!canRedo.value) return;
    historyIndex.value += 1;
    selections.value = cloneSelections(history.value[historyIndex.value]);
  }

  function imageSourceForInference() {
    if (!sourceBitmap) return null;
    return {
      source: sourceBitmap as CanvasImageSource,
      width: imageWidth.value,
      height: imageHeight.value
    };
  }

  function dispose() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    sourceBitmap?.close();
    sourceBitmap = null;
    if (baseCanvas) {
      baseCanvas.width = 0;
      baseCanvas.height = 0;
    }
    baseCanvas = null;
    viewport = null;
  }

  onBeforeUnmount(dispose);

  return {
    ready: readonly(ready),
    busy: readonly(busy),
    error: readonly(error),
    activeTool: readonly(activeTool),
    imageWidth: readonly(imageWidth),
    imageHeight: readonly(imageHeight),
    previewWidth: readonly(previewWidth),
    previewHeight: readonly(previewHeight),
    previewScale: readonly(previewScale),
    zoomPercent: readonly(zoomPercent),
    panX: readonly(panX),
    panY: readonly(panY),
    panning: readonly(panning),
    selections: readonly(selections),
    draftBox: readonly(draftBox),
    canClear,
    canUndo,
    canRedo,
    initialize,
    setTool,
    setZoom,
    zoomIn,
    zoomOut,
    fitPreview,
    zoomFromWheel,
    startPan,
    movePan,
    endPan,
    beginBoxFromClient,
    updateBoxFromClient,
    finishBox,
    cancelBox,
    removeSelection,
    clearSelections,
    undo,
    redo,
    imageSourceForInference
  };
}
