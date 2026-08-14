import {
  computed,
  onBeforeUnmount,
  reactive,
  readonly,
  shallowRef
} from "vue";
import type {
  Canvas as FabricCanvas,
  FabricObject,
  IText as FabricIText,
  Path,
  PencilBrush,
  TSimplePathData
} from "fabric/es";
import {
  createEmptyImageEditorDocument,
  isPristineImageEditorDocument,
  type CropDimension,
  type CropRatio,
  type ImageAdjustment,
  type ImageEditorApplyResult,
  type ImageEditorDocument,
  type ImageEditorSource,
  type ImageEditorTool,
  type ImageGeometryOperation
} from "./types";
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  drawAdjustedImage,
  normalizeImageAdjustments
} from "./imageAdjustments";
import { createImageEditorCropController } from "./imageEditorCrop";
import { renderImageGeometry } from "./imageEditorGeometry";
import { preloadImageEditorRuntime } from "./imageEditorRuntime";
import { createImageEditorViewportController } from "./imageEditorViewport";
import type { FabricRuntime } from "./fabricRuntime";

export { preloadImageEditorRuntime } from "./imageEditorRuntime";

interface EditorElements {
  annotationCanvas: HTMLCanvasElement;
  baseCanvas: HTMLCanvasElement;
  viewport: HTMLElement;
}

interface EditorSnapshot {
  document: ImageEditorDocument;
  signature: string;
}

interface ContextMenuPosition {
  x: number;
  y: number;
}

const MAX_HISTORY = 30;
const EMPTY_ANNOTATIONS = { objects: [] };

function cloneDocument(document: ImageEditorDocument): ImageEditorDocument {
  return JSON.parse(JSON.stringify(document)) as ImageEditorDocument;
}

function normalizeMimeType(mimeType: string) {
  return ["image/jpeg", "image/png", "image/webp"].includes(mimeType)
    ? mimeType
    : "image/png";
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片导出失败，请稍后重试。"))),
      mimeType,
      quality
    );
  });
}

export function useImageEditor(source: ImageEditorSource) {
  const ready = shallowRef(false);
  const busy = shallowRef(false);
  const error = shallowRef("");
  const activeTool = shallowRef<ImageEditorTool>("select");
  const cropRatio = shallowRef<CropRatio>("free");
  const cropWidth = shallowRef(0);
  const cropHeight = shallowRef(0);
  const outputWidth = shallowRef(1);
  const outputHeight = shallowRef(1);
  const previewWidth = shallowRef(1);
  const previewHeight = shallowRef(1);
  const previewScale = shallowRef(1);
  const zoomPercent = shallowRef(100);
  const panX = shallowRef(0);
  const panY = shallowRef(0);
  const panning = shallowRef(false);
  const canUndo = shallowRef(false);
  const canRedo = shallowRef(false);
  const dirty = shallowRef(false);
  const selectedIsText = shallowRef(false);
  const imageContextMenu = shallowRef<ContextMenuPosition | null>(null);
  const textContextMenu = shallowRef<ContextMenuPosition | null>(null);
  const brushColor = shallowRef("#F1F4F8");
  const brushSize = shallowRef(8);
  const textColor = shallowRef("#F1F4F8");
  const textSize = shallowRef(54);
  const textBold = shallowRef(false);
  const adjustments = reactive({ ...DEFAULT_IMAGE_ADJUSTMENTS });

  let fabricModule: FabricRuntime | null = null;
  let canvas: FabricCanvas | null = null;
  let baseCanvas: HTMLCanvasElement | null = null;
  let viewport: HTMLElement | null = null;
  let sourceBitmap: ImageBitmap | null = null;
  let geometryCanvas: HTMLCanvasElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let contextTextObject: FabricIText | null = null;
  let operations: ImageGeometryOperation[] = [];
  let history: EditorSnapshot[] = [];
  let historyIndex = -1;
  let initialSignature = "";
  let restoring = false;
  const transientObjects = new Set<FabricObject>();
  const textListeners = new WeakSet<FabricIText>();
  const cropController = createImageEditorCropController({
    canvas: () => canvas,
    runtime: () => fabricModule,
    transientObjects,
    outputWidth,
    outputHeight,
    previewScale,
    cropRatio,
    cropWidth,
    cropHeight,
    isActive: () => activeTool.value === "crop"
  });
  const clearCropOverlay = cropController.clearOverlay;
  const createCropOverlay = cropController.createOverlay;
  const viewportController = createImageEditorViewportController({
    canvas: () => canvas,
    baseCanvas: () => baseCanvas,
    viewport: () => viewport,
    imageSource: () => geometrySource(),
    outputWidth,
    outputHeight,
    previewWidth,
    previewHeight,
    previewScale,
    zoomPercent,
    panX,
    panY,
    panning,
    ready,
    busy,
    activeTool,
    adjustments,
    annotationObjects,
    prepareAnnotationObject,
    createBrush,
    updateDrawingCursor,
    updateCropControlScale: cropController.updateControlScale
  });
  const {
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
  } = viewportController;

  const outputLabel = computed(() => `${outputWidth.value} × ${outputHeight.value}`);

  async function initialize(elements: EditorElements) {
    busy.value = true;
    error.value = "";
    baseCanvas = elements.baseCanvas;
    viewport = elements.viewport;

    try {
      const [module, bitmap] = await Promise.all([
        preloadImageEditorRuntime(),
        createImageBitmap(source.blob)
      ]);
      fabricModule = module;
      sourceBitmap = bitmap;

      canvas = new module.Canvas(elements.annotationCanvas, {
        backgroundColor: "transparent",
        enableRetinaScaling: true,
        fireRightClick: true,
        preserveObjectStacking: true,
        selection: true,
        stopContextMenu: true,
        uniformScaling: false
      });
      bindCanvasEvents();

      const initialDocument = cloneDocument(
        source.document ?? createEmptyImageEditorDocument()
      );
      initialDocument.adjustments = normalizeImageAdjustments(initialDocument.adjustments);
      operations = initialDocument.operations;
      Object.assign(adjustments, initialDocument.adjustments);
      await rebuildGeometryCanvas();
      await loadAnnotations(initialDocument.annotations);
      resizePreview();
      setTool("select");

      const initial = captureSnapshot();
      history = [initial];
      historyIndex = 0;
      initialSignature = initial.signature;
      syncHistoryFlags();

      resizeObserver = new ResizeObserver(() => resizePreview());
      resizeObserver.observe(elements.viewport);
      ready.value = true;
    } catch (exception) {
      error.value = exception instanceof Error ? exception.message : "图片编辑器加载失败。";
    } finally {
      busy.value = false;
    }
  }

  function bindCanvasEvents() {
    if (!canvas) return;
    canvas.on("path:created", ({ path }) => {
      prepareAnnotationObject(path);
      commitHistory();
    });
    canvas.on("object:modified", ({ target }) => {
      if (!target || transientObjects.has(target) || restoring) return;
      commitHistory();
    });
    canvas.on("selection:created", syncSelectedObject);
    canvas.on("selection:updated", syncSelectedObject);
    canvas.on("selection:cleared", syncSelectedObject);
    canvas.on("mouse:down", ({ e }) => {
      if ((e as MouseEvent).button !== 2) {
        closeImageContextMenu();
        closeTextContextMenu();
      }
    });
    canvas.on("contextmenu", ({ e, target }) => {
      if (!target || target.type !== "i-text" || transientObjects.has(target)) {
        closeTextContextMenu();
        const pointerEvent = e as MouseEvent;
        imageContextMenu.value = {
          x: pointerEvent.clientX,
          y: pointerEvent.clientY
        };
        return;
      }

      const pointerEvent = e as MouseEvent;
      closeImageContextMenu();
      contextTextObject = target as FabricIText;
      canvas?.setActiveObject(contextTextObject);
      syncSelectedObject();
      canvas?.requestRenderAll();
      textContextMenu.value = {
        x: pointerEvent.clientX,
        y: pointerEvent.clientY
      };
    });
  }

  function syncSelectedObject() {
    const active = canvas?.getActiveObject();
    const isText = Boolean(active && active.type === "i-text");
    selectedIsText.value = isText;
    if (!isText) return;

    const text = active as FabricIText;
    textColor.value = typeof text.fill === "string" ? text.fill : textColor.value;
    textSize.value = Math.round(text.fontSize || textSize.value);
    textBold.value = text.fontWeight === "bold" || Number(text.fontWeight) >= 600;
  }

  function annotationObjects() {
    return canvas?.getObjects().filter((object) => !transientObjects.has(object)) ?? [];
  }

  function annotationJson(): Record<string, unknown> {
    return {
      version: fabricModule?.version,
      objects: annotationObjects().map((object) =>
        object.toObject(["selectable", "evented", "globalCompositeOperation"])
      )
    };
  }

  function currentDocument(): ImageEditorDocument {
    return {
      version: 1,
      // 历史快照只保存可持久化文档；裁剪遮罩、选中框等临时 Fabric 对象必须排除。
      operations: JSON.parse(JSON.stringify(operations)) as ImageGeometryOperation[],
      adjustments: { ...adjustments },
      annotations: annotationJson()
    };
  }

  function captureSnapshot(): EditorSnapshot {
    const document = currentDocument();
    return { document, signature: JSON.stringify(document) };
  }

  function syncHistoryFlags() {
    canUndo.value = !restoring && historyIndex > 0;
    canRedo.value = !restoring && historyIndex >= 0 && historyIndex < history.length - 1;
    dirty.value = historyIndex >= 0 && captureSnapshot().signature !== initialSignature;
  }

  function commitHistory() {
    if (!canvas || restoring) return;
    const snapshot = captureSnapshot();
    if (history[historyIndex]?.signature === snapshot.signature) {
      syncHistoryFlags();
      return;
    }

    history = history.slice(0, historyIndex + 1);
    history.push(snapshot);
    if (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
    syncHistoryFlags();
  }

  async function restoreSnapshot(snapshot: EditorSnapshot) {
    if (!canvas) return;
    restoring = true;
    canUndo.value = false;
    canRedo.value = false;
    clearCropOverlay();
    closeTextContextMenu();
    activeTool.value = "select";
    operations = cloneDocument(snapshot.document).operations;
    Object.assign(adjustments, normalizeImageAdjustments(snapshot.document.adjustments));
    await rebuildGeometryCanvas();
    await loadAnnotations(snapshot.document.annotations);
    resizePreview();
    updateInteractionMode();
    restoring = false;
    syncHistoryFlags();
  }

  async function undo() {
    if (!canUndo.value || historyIndex <= 0) return;
    historyIndex -= 1;
    await restoreSnapshot(history[historyIndex]);
  }

  async function redo() {
    if (!canRedo.value || historyIndex >= history.length - 1) return;
    historyIndex += 1;
    await restoreSnapshot(history[historyIndex]);
  }

  async function loadAnnotations(json: Record<string, unknown>) {
    if (!canvas) return;
    transientObjects.clear();
    await canvas.loadFromJSON(
      Object.keys(json).length ? json : EMPTY_ANNOTATIONS
    );
    annotationObjects().forEach(prepareAnnotationObject);
    canvas.requestRenderAll();
  }

  function prepareAnnotationObject(object: FabricObject) {
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim() || "#7898F5";
    const isEraser = object.globalCompositeOperation === "destination-out";
    object.set({
      borderColor: accent,
      cornerColor: accent,
      cornerSize: 10,
      cornerStyle: "rect",
      padding: 3,
      transparentCorners: false,
      selectable: !isEraser,
      evented: !isEraser
    });
    object.setCoords();

    if (object.type === "i-text") attachTextListener(object as FabricIText);
  }

  function attachTextListener(text: FabricIText) {
    if (textListeners.has(text)) return;
    textListeners.add(text);
    text.on("editing:exited", () => commitHistory());
  }

  async function rebuildGeometryCanvas() {
    if (!sourceBitmap) return;
    const previousCanvas = geometryCanvas;
    const result = renderImageGeometry(sourceBitmap, operations);
    if (previousCanvas && previousCanvas !== result.canvas) {
      previousCanvas.width = 0;
      previousCanvas.height = 0;
    }
    geometryCanvas = result.canvas;
    outputWidth.value = result.width;
    outputHeight.value = result.height;
  }

  function geometrySource(): CanvasImageSource | null {
    return geometryCanvas ?? sourceBitmap;
  }

  function setTool(tool: ImageEditorTool) {
    if (!canvas || !ready.value && tool !== "select") return;
    endPan();
    closeImageContextMenu();
    closeTextContextMenu();
    if (activeTool.value === "crop" && tool !== "crop") clearCropOverlay();
    activeTool.value = tool;
    updateInteractionMode();

    if (tool === "crop") createCropOverlay();
    if (tool === "text") addText();
  }

  function updateInteractionMode() {
    if (!canvas || !fabricModule) return;
    const drawing = activeTool.value === "draw" || activeTool.value === "erase";
    const panMode = activeTool.value === "pan";
    canvas.isDrawingMode = drawing;
    canvas.selection = activeTool.value === "select" || activeTool.value === "text";
    canvas.skipTargetFind = panMode;

    annotationObjects().forEach((object) => {
      const isEraser = object.globalCompositeOperation === "destination-out";
      object.set({
        selectable: !isEraser && !drawing && !panMode && activeTool.value !== "crop",
        evented: !isEraser && !drawing && !panMode && activeTool.value !== "crop"
      });
    });

    if (drawing || panMode) {
      canvas.discardActiveObject();
    }
    if (drawing) {
      canvas.freeDrawingBrush = createBrush(activeTool.value === "erase");
    }
    updateDrawingCursor();
    canvas.requestRenderAll();
  }

  function createDrawingCursor(eraser: boolean) {
    const diameter = Math.max(2, brushSize.value * (eraser ? 1.6 : 1));
    let cursorSize = Math.ceil(diameter + 8);
    if (cursorSize % 2 === 0) cursorSize += 1;

    const cursorCanvas = document.createElement("canvas");
    cursorCanvas.width = cursorSize;
    cursorCanvas.height = cursorSize;
    const context = cursorCanvas.getContext("2d");
    if (!context) return "crosshair";

    const center = Math.floor(cursorSize / 2);
    context.beginPath();
    context.arc(center, center, diameter / 2, 0, Math.PI * 2);
    context.fillStyle = eraser ? "rgba(241, 244, 248, 0.16)" : brushColor.value;
    context.globalAlpha = eraser ? 1 : 0.22;
    context.fill();
    context.globalAlpha = 1;
    context.lineWidth = 3;
    context.strokeStyle = "rgba(4, 7, 11, 0.92)";
    context.stroke();
    context.lineWidth = 1;
    context.strokeStyle = "rgba(255, 255, 255, 0.98)";
    context.stroke();

    return `url("${cursorCanvas.toDataURL("image/png")}") ${center} ${center}, crosshair`;
  }

  function updateDrawingCursor() {
    if (!canvas) return;
    const drawing = activeTool.value === "draw" || activeTool.value === "erase";
    const panMode = activeTool.value === "pan";
    const cursor = drawing
      ? createDrawingCursor(activeTool.value === "erase")
      : panMode ? (panning.value ? "grabbing" : "grab") : "default";
    canvas.freeDrawingCursor = cursor;
    canvas.defaultCursor = cursor;
    canvas.hoverCursor = panMode ? cursor : "move";
    canvas.moveCursor = panMode ? cursor : "move";
    canvas.setCursor(cursor);
  }

  function createBrush(eraser: boolean): PencilBrush {
    if (!canvas || !fabricModule) throw new Error("图片编辑器尚未加载完成。");
    const brush = new fabricModule.PencilBrush(canvas);
    brush.width = (eraser ? brushSize.value * 1.6 : brushSize.value) /
      Math.max(previewScale.value, 0.01);
    brush.color = eraser ? "#000000" : brushColor.value;
    brush.strokeLineCap = "round";
    brush.strokeLineJoin = "round";

    if (eraser) {
      const setBrushStyles = brush._setBrushStyles.bind(brush);
      brush._setBrushStyles = (context: CanvasRenderingContext2D) => {
        setBrushStyles(context);
        context.globalCompositeOperation = "destination-out";
      };
      const createPath = brush.createPath.bind(brush);
      brush.createPath = (pathData: TSimplePathData): Path => {
        const path = createPath(pathData);
        path.set({
          evented: false,
          globalCompositeOperation: "destination-out",
          selectable: false
        });
        return path;
      };
    }
    return brush;
  }

  function setBrushColor(color: string) {
    brushColor.value = color;
    if (activeTool.value === "draw" && canvas) {
      canvas.freeDrawingBrush = createBrush(false);
      updateDrawingCursor();
    }
  }

  function setBrushSize(size: number) {
    brushSize.value = size;
    if ((activeTool.value === "draw" || activeTool.value === "erase") && canvas) {
      canvas.freeDrawingBrush = createBrush(activeTool.value === "erase");
      updateDrawingCursor();
    }
  }

  function addText() {
    if (!canvas || !fabricModule) return;
    canvas.isDrawingMode = false;
    const size = Math.round(Math.max(28, Math.min(outputWidth.value, outputHeight.value) * 0.055));
    textSize.value = size;
    const text = new fabricModule.IText("输入文字", {
      fill: textColor.value,
      fontFamily: getComputedStyle(document.body).fontFamily,
      fontSize: size,
      fontWeight: textBold.value ? "bold" : "normal",
      left: outputWidth.value / 2,
      originX: "center",
      originY: "center",
      top: outputHeight.value / 2
    });
    prepareAnnotationObject(text);
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.requestRenderAll();
    commitHistory();
    text.enterEditing();
    text.selectAll();
  }

  function activeTextObject() {
    const active = canvas?.getActiveObject();
    return active?.type === "i-text" ? active as FabricIText : null;
  }

  function setTextColor(color: string, commit = false) {
    textColor.value = color;
    const text = activeTextObject();
    if (text) {
      text.set({ fill: color });
      canvas?.requestRenderAll();
      if (commit) commitHistory();
    }
  }

  function setTextSize(size: number, commit = false) {
    textSize.value = size;
    const text = activeTextObject();
    if (text) {
      text.set({ fontSize: size });
      text.setCoords();
      canvas?.requestRenderAll();
      if (commit) commitHistory();
    }
  }

  function toggleTextBold() {
    textBold.value = !textBold.value;
    const text = activeTextObject();
    if (text) {
      text.set({ fontWeight: textBold.value ? "bold" : "normal" });
      text.setCoords();
      canvas?.requestRenderAll();
      commitHistory();
    }
  }

  function setAdjustment(adjustment: ImageAdjustment, value: number, commit = false) {
    const normalized = normalizeImageAdjustments({ ...adjustments, [adjustment]: value });
    adjustments[adjustment] = normalized[adjustment];
    renderBasePreview();
    if (commit) commitHistory();
    else dirty.value = captureSnapshot().signature !== initialSignature;
  }

  function setCropRatio(ratio: CropRatio) {
    cropController.setRatio(ratio);
  }

  function setCropDimension(dimension: CropDimension, value: number) {
    cropController.setDimension(dimension, value);
  }

  async function applyCrop() {
    const bounds = cropController.prepareSelection();
    if (!bounds) return;
    const oldWidth = outputWidth.value;
    const oldHeight = outputHeight.value;
    const x = bounds.left;
    const y = bounds.top;
    const width = bounds.width;
    const height = bounds.height;
    if (x === 0 && y === 0 && width === oldWidth && height === oldHeight) {
      setTool("select");
      return;
    }

    annotationObjects().forEach((object) => {
      object.set({ left: object.left - x, top: object.top - y });
      object.setCoords();
    });
    operations.push({
      type: "crop",
      x: x / oldWidth,
      y: y / oldHeight,
      width: width / oldWidth,
      height: height / oldHeight
    });
    clearCropOverlay();
    activeTool.value = "select";
    await rebuildGeometryCanvas();
    resizePreview();
    updateInteractionMode();
    commitHistory();
  }

  function cancelCrop() {
    setTool("select");
  }

  async function rotate(direction: "clockwise" | "counterclockwise") {
    if (!fabricModule) return;
    if (activeTool.value === "crop") clearCropOverlay();
    const oldWidth = outputWidth.value;
    const oldHeight = outputHeight.value;
    annotationObjects().forEach((object) => {
      const center = object.getCenterPoint();
      const nextCenter = direction === "clockwise"
        ? new fabricModule!.Point(oldHeight - center.y, center.x)
        : new fabricModule!.Point(center.y, oldWidth - center.x);
      object.rotate((object.angle || 0) + (direction === "clockwise" ? 90 : -90));
      object.setPositionByOrigin(nextCenter, "center", "center");
      object.setCoords();
    });
    operations.push({ type: "rotate", direction });
    activeTool.value = "select";
    await rebuildGeometryCanvas();
    resizePreview();
    updateInteractionMode();
    commitHistory();
  }

  async function flip(axis: "horizontal" | "vertical") {
    if (!fabricModule) return;
    if (activeTool.value === "crop") clearCropOverlay();
    annotationObjects().forEach((object) => {
      const center = object.getCenterPoint();
      const nextCenter = axis === "horizontal"
        ? new fabricModule!.Point(outputWidth.value - center.x, center.y)
        : new fabricModule!.Point(center.x, outputHeight.value - center.y);
      object.set(axis === "horizontal"
        ? { flipX: !object.flipX }
        : { flipY: !object.flipY });
      object.setPositionByOrigin(nextCenter, "center", "center");
      object.setCoords();
    });
    operations.push({ type: "flip", axis });
    activeTool.value = "select";
    await rebuildGeometryCanvas();
    resizePreview();
    updateInteractionMode();
    commitHistory();
  }

  async function reset() {
    if (!canvas) return;
    closeTextContextMenu();
    clearCropOverlay();
    operations = [];
    Object.assign(adjustments, DEFAULT_IMAGE_ADJUSTMENTS);
    canvas.clear();
    await rebuildGeometryCanvas();
    activeTool.value = "select";
    fitPreview();
    updateInteractionMode();
    commitHistory();
  }

  function deleteSelected() {
    if (!canvas) return;
    const objects = canvas.getActiveObjects().filter((object) => !transientObjects.has(object));
    if (!objects.length) return;
    if (contextTextObject && objects.includes(contextTextObject)) closeTextContextMenu();
    objects.forEach((object) => canvas?.remove(object));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    syncSelectedObject();
    commitHistory();
  }

  function closeTextContextMenu() {
    textContextMenu.value = null;
    contextTextObject = null;
  }

  function closeImageContextMenu() {
    imageContextMenu.value = null;
  }

  function deleteContextText() {
    if (!canvas || !contextTextObject || !canvas.getObjects().includes(contextTextObject)) {
      closeTextContextMenu();
      return;
    }

    const text = contextTextObject;
    closeTextContextMenu();
    if (text.isEditing) text.exitEditing();
    canvas.remove(text);
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    syncSelectedObject();
    commitHistory();
  }

  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.matches("input, textarea, select, [contenteditable='true']")) return false;
    const active = canvas?.getActiveObject();
    if (active?.type === "i-text" && (active as FabricIText).isEditing) return false;

    const modifier = event.metaKey || event.ctrlKey;
    if (modifier && event.key.toLowerCase() === "z") {
      event.preventDefault();
      void (event.shiftKey ? redo() : undo());
      return true;
    }
    if (modifier && event.key.toLowerCase() === "y") {
      event.preventDefault();
      void redo();
      return true;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!active) return false;
      event.preventDefault();
      deleteSelected();
      return true;
    }
    if (!active || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return false;
    }

    const step = (event.shiftKey ? 10 : 1) / Math.max(previewScale.value, 0.01);
    event.preventDefault();
    if (event.key === "ArrowLeft") active.left -= step;
    if (event.key === "ArrowRight") active.left += step;
    if (event.key === "ArrowUp") active.top -= step;
    if (event.key === "ArrowDown") active.top += step;
    active.setCoords();
    canvas?.requestRenderAll();
    commitHistory();
    return true;
  }

  async function exportAnnotations() {
    if (!fabricModule || !annotationObjects().length) return null;
    const exportCanvas = new fabricModule.StaticCanvas(undefined, {
      enableRetinaScaling: false,
      height: outputHeight.value,
      renderOnAddRemove: false,
      width: outputWidth.value
    });
    await exportCanvas.loadFromJSON(annotationJson());
    exportCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    exportCanvas.renderAll();
    const element = exportCanvas.toCanvasElement(1);
    exportCanvas.destroy();
    return element;
  }

  async function applyEdits(): Promise<ImageEditorApplyResult> {
    const imageSource = geometrySource();
    if (!imageSource) throw new Error("图片编辑器尚未加载完成。");
    const document = currentDocument();
    if (isPristineImageEditorDocument(document)) return { pristine: true };

    busy.value = true;
    error.value = "";
    try {
      const output = window.document.createElement("canvas");
      output.width = outputWidth.value;
      output.height = outputHeight.value;
      const context = output.getContext("2d");
      if (!context) throw new Error("当前设备无法导出该图片。");
      drawAdjustedImage(
        context,
        imageSource,
        outputWidth.value,
        outputHeight.value,
        adjustments
      );
      const annotationCanvas = await exportAnnotations();
      if (annotationCanvas) context.drawImage(annotationCanvas, 0, 0);

      const mimeType = normalizeMimeType(source.mimeType);
      const quality = mimeType === "image/png"
        ? undefined
        : Math.max(0.01, Math.min(1, source.quality ?? 0.92));
      const blob = await canvasToBlob(output, mimeType, quality);
      return {
        pristine: false,
        blob,
        document,
        width: outputWidth.value,
        height: outputHeight.value,
        mimeType
      };
    } catch (exception) {
      error.value = exception instanceof Error ? exception.message : "图片导出失败。";
      throw exception;
    } finally {
      busy.value = false;
    }
  }

  function markApplied() {
    initialSignature = captureSnapshot().signature;
    syncHistoryFlags();
  }

  function dispose() {
    closeImageContextMenu();
    closeTextContextMenu();
    resizeObserver?.disconnect();
    resizeObserver = null;
    viewportController.dispose();
    if (canvas) void canvas.dispose();
    canvas = null;
    sourceBitmap?.close();
    sourceBitmap = null;
    if (geometryCanvas) {
      geometryCanvas.width = 0;
      geometryCanvas.height = 0;
    }
    geometryCanvas = null;
  }

  onBeforeUnmount(dispose);

  return {
    activeTool: readonly(activeTool),
    adjustments: readonly(adjustments),
    brushColor: readonly(brushColor),
    brushSize: readonly(brushSize),
    busy: readonly(busy),
    canRedo: readonly(canRedo),
    canUndo: readonly(canUndo),
    cropHeight: readonly(cropHeight),
    cropRatio: readonly(cropRatio),
    cropWidth: readonly(cropWidth),
    dirty: readonly(dirty),
    error: readonly(error),
    imageContextMenu: readonly(imageContextMenu),
    outputHeight: readonly(outputHeight),
    outputLabel,
    outputWidth: readonly(outputWidth),
    previewHeight: readonly(previewHeight),
    previewWidth: readonly(previewWidth),
    panX: readonly(panX),
    panY: readonly(panY),
    panning: readonly(panning),
    ready: readonly(ready),
    selectedIsText: readonly(selectedIsText),
    textContextMenu: readonly(textContextMenu),
    textBold: readonly(textBold),
    textColor: readonly(textColor),
    textSize: readonly(textSize),
    zoomPercent: readonly(zoomPercent),
    addText,
    applyCrop,
    applyEdits,
    cancelCrop,
    closeImageContextMenu,
    closeTextContextMenu,
    deleteContextText,
    deleteSelected,
    endPan,
    fitPreview,
    flip,
    handleKeydown,
    initialize,
    markApplied,
    movePan,
    redo,
    reset,
    rotate,
    setAdjustment,
    setBrushColor,
    setBrushSize,
    setCropDimension,
    setCropRatio,
    setTextColor,
    setTextSize,
    setTool,
    setZoom,
    startPan,
    toggleTextBold,
    undo,
    zoomFromWheel,
    zoomIn,
    zoomOut
  };
}
