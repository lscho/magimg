import {
  computed,
  onBeforeUnmount,
  readonly,
  shallowRef
} from "vue";
import {
  applyAutomaticNesting,
  cloneCutoutSelections,
  setSelectionBackground,
  setSelectionIndependent,
  translateCutoutSelection
} from "@/services/cutoutSelectionModel";
import {
  cutoutPolygonBounds,
  pointInCutoutPolygon
} from "@/services/cutoutSelectionShape";
import type {
  CutoutBrushOperation,
  CutoutBrushPoint,
  CutoutRemovalStroke,
  CutoutSelection,
  CutoutSelectionBox
} from "@/types";

interface CutoutCanvasElements {
  baseCanvas: HTMLCanvasElement;
  viewport: HTMLElement;
}

export type CutoutTool = "box" | "polygon" | "text-box" | "erase" | "pan";

interface SelectionMoveState {
  id: string;
  originX: number;
  originY: number;
  selectionX: number;
  selectionY: number;
  snapshot: CutoutSelection[];
  moved: boolean;
}

const MIN_ZOOM_PERCENT = 25;
const MAX_ZOOM_PERCENT = 400;
const ZOOM_BUTTON_STEP = 25;
const PAN_VIEWPORT_PADDING_PX = 16;
const PAN_MIN_VISIBLE_PX = 48;
const POLYGON_CLOSE_DISTANCE_PX = 10;

let selectionIdCounter = 0;

function nextSelectionId() {
  selectionIdCounter += 1;
  return `cutout-sel-${Date.now()}-${selectionIdCounter}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 管理抠图画布的图片预览、缩放、拖动与选区。
 * 矩形和点选轮廓都使用原生 pointer 事件，坐标始终保存为原图像素。
 */
export function useCutoutSelection(
  imageSource: { blob: Blob; mimeType: string } | null,
  initialSelections: (CutoutSelectionBox | CutoutSelection)[] = []
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
  const movingSelectionId = shallowRef<string | null>(null);
  const activeSelectionId = shallowRef<string | null>(null);
  const brushOperation = shallowRef<CutoutBrushOperation>("add");
  const brushRadius = shallowRef(24);
  const smartBrush = shallowRef(true);
  const initialSelectionSnapshot = applyAutomaticNesting(initialSelections);
  const selections = shallowRef<CutoutSelection[]>(initialSelectionSnapshot);
  const draftBox = shallowRef<CutoutSelectionBox | null>(null);
  const draftPolygon = shallowRef<CutoutBrushPoint[]>([]);
  const polygonCursor = shallowRef<CutoutBrushPoint | null>(null);
  const draftStroke = shallowRef<CutoutRemovalStroke | null>(null);
  const history = shallowRef<CutoutSelection[][]>([
    cloneCutoutSelections(initialSelectionSnapshot)
  ]);
  const historyIndex = shallowRef(0);

  let baseCanvas: HTMLCanvasElement | null = null;
  let viewport: HTMLElement | null = null;
  let sourceBitmap: ImageBitmap | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let drawingOrigin: { x: number; y: number } | null = null;
  let selectionMove: SelectionMoveState | null = null;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginX = 0;
  let panOriginY = 0;

  const canClear = computed(() => selections.value.length > 0 || draftPolygon.value.length > 0);
  const canUndo = computed(() => historyIndex.value > 0);
  const canRedo = computed(() => historyIndex.value < history.value.length - 1);
  const activeSelection = computed(() =>
    selections.value.find((selection) => selection.id === activeSelectionId.value) ?? null
  );

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
    cancelPolygon();
    cancelStroke();
    cancelMoveSelection();
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

  function startViewPan(clientX: number, clientY: number): boolean {
    if (!ready.value || busy.value) return false;
    panning.value = true;
    panStartX = clientX;
    panStartY = clientY;
    panOriginX = panX.value;
    panOriginY = panY.value;
    return true;
  }

  function startPan(clientX: number, clientY: number): boolean {
    if (activeTool.value !== "pan") return false;
    return startViewPan(clientX, clientY);
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

  function beginMoveSelection(
    selectionId: string,
    clientX: number,
    clientY: number
  ): boolean {
    if (!["box", "polygon", "text-box"].includes(activeTool.value) || !ready.value || busy.value) return false;
    const selection = selections.value.find((candidate) => candidate.id === selectionId);
    if (!selection) return false;
    const point = clientToImage(clientX, clientY);
    selectionMove = {
      id: selection.id,
      originX: point.x,
      originY: point.y,
      selectionX: selection.x,
      selectionY: selection.y,
      snapshot: cloneCutoutSelections(selections.value),
      moved: false
    };
    movingSelectionId.value = selection.id;
    activeSelectionId.value = selection.id;
    return true;
  }

  function moveSelectionFromClient(clientX: number, clientY: number) {
    if (!selectionMove) return;
    const point = clientToImage(clientX, clientY);
    const nextX = selectionMove.selectionX + point.x - selectionMove.originX;
    const nextY = selectionMove.selectionY + point.y - selectionMove.originY;
    const next = translateCutoutSelection(
      selectionMove.snapshot,
      selectionMove.id,
      nextX,
      nextY,
      imageWidth.value,
      imageHeight.value,
      false
    );
    const movedSelection = next.find((selection) => selection.id === selectionMove?.id);
    if (!movedSelection) return;
    selectionMove.moved = selectionMove.moved ||
      movedSelection.x !== selectionMove.selectionX ||
      movedSelection.y !== selectionMove.selectionY;
    selections.value = next;
  }

  function finishMoveSelection() {
    const move = selectionMove;
    selectionMove = null;
    movingSelectionId.value = null;
    const current = move
      ? selections.value.find((selection) => selection.id === move.id)
      : null;
    if (!move?.moved || !current ||
      (current.x === move.selectionX && current.y === move.selectionY)) return;
    commitSelections(selections.value);
  }

  function cancelMoveSelection() {
    if (selectionMove) selections.value = cloneCutoutSelections(selectionMove.snapshot);
    selectionMove = null;
    movingSelectionId.value = null;
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
    if (!["box", "text-box"].includes(activeTool.value) || !ready.value || busy.value) return false;
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

  function selectionContains(selection: CutoutSelection, x: number, y: number) {
    if (selection.polygon?.length) {
      return pointInCutoutPolygon({ x, y }, selection.polygon);
    }
    return x >= selection.x && y >= selection.y &&
      x <= selection.x + selection.width && y <= selection.y + selection.height;
  }

  function selectionAtPoint(x: number, y: number) {
    return selections.value
      .filter((selection) => selectionContains(selection, x, y))
      .sort((a, b) => a.width * a.height - b.width * b.height)[0] ?? null;
  }

  function selectionAtClientPoint(clientX: number, clientY: number) {
    const point = clientToImage(clientX, clientY);
    return point.inside ? selectionAtPoint(point.x, point.y) : null;
  }

  function pointInsideSelection(selection: CutoutSelection, clientX: number, clientY: number) {
    const point = clientToImage(clientX, clientY);
    if (!point.inside || !selectionContains(selection, point.x, point.y)) return null;
    return { x: point.x, y: point.y };
  }

  function beginStrokeFromClient(clientX: number, clientY: number): boolean {
    if (activeTool.value !== "erase" || !ready.value || busy.value) return false;
    const selection = activeSelection.value;
    if (!selection || selection.behavior !== "background") return false;
    const imagePoint = pointInsideSelection(selection, clientX, clientY);
    if (!imagePoint) return false;
    draftStroke.value = {
      id: `cutout-stroke-${Date.now()}-${crypto.randomUUID()}`,
      operation: brushOperation.value,
      radius: brushRadius.value,
      smart: smartBrush.value && brushOperation.value === "add",
      points: [{ x: imagePoint.x, y: imagePoint.y }]
    };
    return true;
  }

  function updateStrokeFromClient(clientX: number, clientY: number) {
    const stroke = draftStroke.value;
    const selection = activeSelection.value;
    if (!stroke || !selection) return;
    const point = pointInsideSelection(selection, clientX, clientY);
    if (!point) return;
    const previous = stroke.points[stroke.points.length - 1];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < Math.max(1, stroke.radius / 4)) {
      return;
    }
    draftStroke.value = { ...stroke, points: [...stroke.points, point] };
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

  function updatePolygonCursorFromClient(clientX: number, clientY: number) {
    if (activeTool.value !== "polygon" || !draftPolygon.value.length) {
      polygonCursor.value = null;
      return;
    }
    const point = clientToImage(clientX, clientY);
    polygonCursor.value = point.inside ? { x: point.x, y: point.y } : null;
  }

  function clearPolygonCursor() {
    polygonCursor.value = null;
  }

  function addPolygonPointFromClient(clientX: number, clientY: number): boolean {
    if (activeTool.value !== "polygon" || !ready.value || busy.value) return false;
    const point = clientToImage(clientX, clientY);
    if (!point.inside) return false;
    const nextPoint = { x: point.x, y: point.y };
    const first = draftPolygon.value[0];
    const closeDistance = POLYGON_CLOSE_DISTANCE_PX / Math.max(previewScale.value, 0.01);
    if (first && draftPolygon.value.length >= 3 &&
      Math.hypot(first.x - nextPoint.x, first.y - nextPoint.y) <= closeDistance) {
      return finishPolygon();
    }
    draftPolygon.value = [...draftPolygon.value, nextPoint];
    polygonCursor.value = nextPoint;
    return true;
  }

  function finishPolygon(): boolean {
    const points = draftPolygon.value;
    const bounds = cutoutPolygonBounds(points);
    if (points.length < 3 || !bounds) return false;
    const minSize = 4 / Math.max(previewScale.value, 0.01);
    if (bounds.width < minSize || bounds.height < minSize) return false;
    const x = clamp(Math.floor(bounds.x), 0, imageWidth.value - 1);
    const y = clamp(Math.floor(bounds.y), 0, imageHeight.value - 1);
    const right = clamp(Math.ceil(bounds.x + bounds.width), x + 1, imageWidth.value);
    const bottom = clamp(Math.ceil(bounds.y + bounds.height), y + 1, imageHeight.value);
    const selection: CutoutSelection = {
      id: nextSelectionId(),
      x,
      y,
      width: right - x,
      height: bottom - y,
      layerKind: "element",
      polygon: points.map((point) => ({ ...point })),
      behavior: "extract",
      parentId: null,
      relationSource: "auto",
      removalStrokes: []
    };
    draftPolygon.value = [];
    polygonCursor.value = null;
    commitSelections([...selections.value, selection]);
    activeSelectionId.value = selection.id;
    return true;
  }

  function removeLastPolygonPoint() {
    if (!draftPolygon.value.length) return;
    draftPolygon.value = draftPolygon.value.slice(0, -1);
    if (!draftPolygon.value.length) polygonCursor.value = null;
  }

  function cancelPolygon() {
    draftPolygon.value = [];
    polygonCursor.value = null;
  }

  function commitSelections(
    next: readonly (CutoutSelectionBox | CutoutSelection)[],
    resolveNesting = true
  ) {
    const snapshot = resolveNesting
      ? applyAutomaticNesting(next)
      : cloneCutoutSelections(next);
    selections.value = snapshot;
    history.value = [
      ...history.value.slice(0, historyIndex.value + 1),
      cloneCutoutSelections(snapshot)
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

    const selection: CutoutSelection = {
      id: nextSelectionId(),
      x: clamp(Math.round(draft.x), 0, imageWidth.value - 1),
      y: clamp(Math.round(draft.y), 0, imageHeight.value - 1),
      width: Math.max(1, Math.round(draft.width)),
      height: Math.max(1, Math.round(draft.height)),
      layerKind: activeTool.value === "text-box" ? "text" : "element",
      behavior: "extract",
      parentId: null,
      relationSource: "auto",
      removalStrokes: []
    };
    selection.width = Math.min(selection.width, imageWidth.value - selection.x);
    selection.height = Math.min(selection.height, imageHeight.value - selection.y);
    commitSelections([...selections.value, selection]);
    activeSelectionId.value = selection.id;
  }

  function cancelBox() {
    drawingOrigin = null;
    draftBox.value = null;
  }

  function finishStroke() {
    const stroke = draftStroke.value;
    const selectionId = activeSelectionId.value;
    draftStroke.value = null;
    if (!stroke || !stroke.points.length || !selectionId) return;
    commitSelections(
      selections.value.map((selection) => selection.id === selectionId
        ? { ...selection, removalStrokes: [...selection.removalStrokes, stroke] }
        : selection),
      false
    );
  }

  function cancelStroke() {
    draftStroke.value = null;
  }

  function selectSelection(id: string) {
    if (selections.value.some((selection) => selection.id === id)) {
      activeSelectionId.value = id;
    }
  }

  function makeSelectionIndependent(id: string) {
    commitSelections(setSelectionIndependent(selections.value, id), false);
    activeSelectionId.value = id;
  }

  function makeSelectionBackground(id: string) {
    commitSelections(setSelectionBackground(selections.value, id), false);
    activeSelectionId.value = id;
  }

  function setBrushOperation(operation: CutoutBrushOperation) {
    brushOperation.value = operation;
  }

  function setBrushRadius(radius: number) {
    brushRadius.value = clamp(Math.round(radius), 4, 160);
  }

  function setSmartBrush(enabled: boolean) {
    smartBrush.value = enabled;
  }

  function removeSelection(id: string) {
    const next = selections.value.filter((selection) => selection.id !== id);
    if (next.length === selections.value.length) return;
    commitSelections(next);
    if (activeSelectionId.value === id) activeSelectionId.value = null;
  }

  function clearSelections() {
    cancelPolygon();
    if (!selections.value.length) return;
    commitSelections([]);
    activeSelectionId.value = null;
  }

  function replaceSelections(next: readonly (CutoutSelectionBox | CutoutSelection)[]) {
    cancelBox();
    cancelPolygon();
    cancelStroke();
    cancelMoveSelection();
    commitSelections(next);
    activeSelectionId.value = null;
  }

  function undo() {
    if (!canUndo.value) return;
    historyIndex.value -= 1;
    selections.value = cloneCutoutSelections(history.value[historyIndex.value]);
    if (activeSelectionId.value && !activeSelection.value) activeSelectionId.value = null;
  }

  function redo() {
    if (!canRedo.value) return;
    historyIndex.value += 1;
    selections.value = cloneCutoutSelections(history.value[historyIndex.value]);
    if (activeSelectionId.value && !activeSelection.value) activeSelectionId.value = null;
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
    movingSelectionId: readonly(movingSelectionId),
    activeSelectionId: readonly(activeSelectionId),
    activeSelection,
    brushOperation: readonly(brushOperation),
    brushRadius: readonly(brushRadius),
    smartBrush: readonly(smartBrush),
    selections: readonly(selections),
    draftBox: readonly(draftBox),
    draftPolygon: readonly(draftPolygon),
    polygonCursor: readonly(polygonCursor),
    draftStroke: readonly(draftStroke),
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
    clientToImage,
    selectionAtClientPoint,
    startViewPan,
    startPan,
    movePan,
    endPan,
    beginMoveSelection,
    moveSelectionFromClient,
    finishMoveSelection,
    cancelMoveSelection,
    beginBoxFromClient,
    updateBoxFromClient,
    finishBox,
    cancelBox,
    updatePolygonCursorFromClient,
    clearPolygonCursor,
    addPolygonPointFromClient,
    finishPolygon,
    removeLastPolygonPoint,
    cancelPolygon,
    beginStrokeFromClient,
    updateStrokeFromClient,
    finishStroke,
    cancelStroke,
    selectSelection,
    makeSelectionIndependent,
    makeSelectionBackground,
    setBrushOperation,
    setBrushRadius,
    setSmartBrush,
    removeSelection,
    clearSelections,
    replaceSelections,
    undo,
    redo,
    imageSourceForInference
  };
}
