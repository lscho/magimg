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
  Rect as FabricRect,
  TSimplePathData
} from "fabric";
import {
  createEmptyImageEditorDocument,
  isPristineImageEditorDocument,
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
  hasImageAdjustments,
  normalizeImageAdjustments
} from "./imageAdjustments";

type FabricModule = typeof import("fabric");

let fabricRuntimePromise: Promise<FabricModule> | null = null;

export function preloadImageEditorRuntime(): Promise<FabricModule> {
  if (!fabricRuntimePromise) {
    fabricRuntimePromise = import("fabric").catch((exception) => {
      fabricRuntimePromise = null;
      throw exception;
    });
  }
  return fabricRuntimePromise;
}

interface EditorElements {
  annotationCanvas: HTMLCanvasElement;
  baseCanvas: HTMLCanvasElement;
  viewport: HTMLElement;
}

interface EditorSnapshot {
  document: ImageEditorDocument;
  signature: string;
}

interface TextContextMenuPosition {
  x: number;
  y: number;
}

const MAX_HISTORY = 30;
const EMPTY_ANNOTATIONS = { objects: [] };
const CROP_EDGE_TOLERANCE_PX = 4;

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
  const outputWidth = shallowRef(1);
  const outputHeight = shallowRef(1);
  const previewWidth = shallowRef(1);
  const previewHeight = shallowRef(1);
  const previewScale = shallowRef(1);
  const canUndo = shallowRef(false);
  const canRedo = shallowRef(false);
  const dirty = shallowRef(false);
  const selectedIsText = shallowRef(false);
  const textContextMenu = shallowRef<TextContextMenuPosition | null>(null);
  const brushColor = shallowRef("#F1F4F8");
  const brushSize = shallowRef(8);
  const textColor = shallowRef("#F1F4F8");
  const textSize = shallowRef(54);
  const textBold = shallowRef(false);
  const adjustments = reactive({ ...DEFAULT_IMAGE_ADJUSTMENTS });

  let fabricModule: FabricModule | null = null;
  let canvas: FabricCanvas | null = null;
  let baseCanvas: HTMLCanvasElement | null = null;
  let viewport: HTMLElement | null = null;
  let sourceBitmap: ImageBitmap | null = null;
  let geometryCanvas: HTMLCanvasElement | null = null;
  let previewAdjustmentCanvas: HTMLCanvasElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let cropBox: FabricRect | null = null;
  let cropShade: FabricRect | null = null;
  let cropShadeClip: FabricRect | null = null;
  let contextTextObject: FabricIText | null = null;
  let operations: ImageGeometryOperation[] = [];
  let history: EditorSnapshot[] = [];
  let historyIndex = -1;
  let initialSignature = "";
  let restoring = false;
  const transientObjects = new Set<FabricObject>();
  const textListeners = new WeakSet<FabricIText>();

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
      if ((e as MouseEvent).button !== 2) closeTextContextMenu();
    });
    canvas.on("contextmenu", ({ e, target }) => {
      if (!target || target.type !== "i-text" || transientObjects.has(target)) {
        closeTextContextMenu();
        return;
      }

      const pointerEvent = e as MouseEvent;
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

    if (!operations.length) {
      if (geometryCanvas) {
        geometryCanvas.width = 0;
        geometryCanvas.height = 0;
      }
      geometryCanvas = null;
      outputWidth.value = sourceBitmap.width;
      outputHeight.value = sourceBitmap.height;
      return;
    }

    let current: CanvasImageSource = sourceBitmap;
    let currentWidth = sourceBitmap.width;
    let currentHeight = sourceBitmap.height;

    for (const operation of operations) {
      const next = document.createElement("canvas");
      const context = next.getContext("2d");
      if (!context) throw new Error("当前设备无法处理该图片。");

      if (operation.type === "rotate") {
        next.width = currentHeight;
        next.height = currentWidth;
        if (operation.direction === "clockwise") {
          context.translate(next.width, 0);
          context.rotate(Math.PI / 2);
        } else {
          context.translate(0, next.height);
          context.rotate(-Math.PI / 2);
        }
        context.drawImage(current, 0, 0);
      } else if (operation.type === "flip") {
        next.width = currentWidth;
        next.height = currentHeight;
        if (operation.axis === "horizontal") {
          context.translate(next.width, 0);
          context.scale(-1, 1);
        } else {
          context.translate(0, next.height);
          context.scale(1, -1);
        }
        context.drawImage(current, 0, 0);
      } else {
        const x = Math.max(0, Math.round(operation.x * currentWidth));
        const y = Math.max(0, Math.round(operation.y * currentHeight));
        const width = Math.max(
          1,
          Math.min(currentWidth - x, Math.round(operation.width * currentWidth))
        );
        const height = Math.max(
          1,
          Math.min(currentHeight - y, Math.round(operation.height * currentHeight))
        );
        next.width = width;
        next.height = height;
        context.drawImage(current, x, y, width, height, 0, 0, width, height);
      }
      current = next;
      currentWidth = next.width;
      currentHeight = next.height;
    }

    geometryCanvas = current as HTMLCanvasElement;
    outputWidth.value = currentWidth;
    outputHeight.value = currentHeight;
  }

  function geometrySource(): CanvasImageSource | null {
    return geometryCanvas ?? sourceBitmap;
  }

  function resizePreview() {
    if (!viewport || !canvas || !baseCanvas) return;
    const availableWidth = Math.max(120, viewport.clientWidth - 32);
    const availableHeight = Math.max(120, viewport.clientHeight - 32);
    const scale = Math.max(
      0.01,
      Math.min(availableWidth / outputWidth.value, availableHeight / outputHeight.value)
    );
    previewScale.value = scale;
    previewWidth.value = Math.max(1, Math.floor(outputWidth.value * scale));
    previewHeight.value = Math.max(1, Math.floor(outputHeight.value * scale));

    canvas.setDimensions({ width: previewWidth.value, height: previewHeight.value });
    canvas.setViewportTransform([scale, 0, 0, scale, 0, 0]);
    annotationObjects().forEach(prepareAnnotationObject);
    if (activeTool.value === "draw" || activeTool.value === "erase") {
      canvas.freeDrawingBrush = createBrush(activeTool.value === "erase");
      updateDrawingCursor();
    }
    updateCropControlScale();
    renderBasePreview();
    canvas.requestRenderAll();
  }

  function renderBasePreview() {
    const imageSource = geometrySource();
    if (!baseCanvas || !imageSource) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    baseCanvas.width = Math.max(1, Math.floor(previewWidth.value * dpr));
    baseCanvas.height = Math.max(1, Math.floor(previewHeight.value * dpr));
    baseCanvas.style.width = `${previewWidth.value}px`;
    baseCanvas.style.height = `${previewHeight.value}px`;
    const context = baseCanvas.getContext("2d");
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!hasImageAdjustments(adjustments)) {
      context.drawImage(imageSource, 0, 0, previewWidth.value, previewHeight.value);
      return;
    }

    previewAdjustmentCanvas ??= document.createElement("canvas");
    previewAdjustmentCanvas.width = previewWidth.value;
    previewAdjustmentCanvas.height = previewHeight.value;
    const adjustmentContext = previewAdjustmentCanvas.getContext("2d");
    if (!adjustmentContext) return;
    drawAdjustedImage(
      adjustmentContext,
      imageSource,
      previewWidth.value,
      previewHeight.value,
      adjustments
    );
    context.drawImage(previewAdjustmentCanvas, 0, 0, previewWidth.value, previewHeight.value);
  }

  function setTool(tool: ImageEditorTool) {
    if (!canvas || !ready.value && tool !== "select") return;
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
    canvas.isDrawingMode = drawing;
    canvas.selection = activeTool.value === "select" || activeTool.value === "text";

    annotationObjects().forEach((object) => {
      const isEraser = object.globalCompositeOperation === "destination-out";
      object.set({
        selectable: !isEraser && !drawing && activeTool.value !== "crop",
        evented: !isEraser && !drawing && activeTool.value !== "crop"
      });
    });

    if (drawing) {
      canvas.discardActiveObject();
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
    const cursor = drawing
      ? createDrawingCursor(activeTool.value === "erase")
      : "default";
    canvas.freeDrawingCursor = cursor;
    canvas.defaultCursor = cursor;
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

  function ratioValue(ratio: CropRatio) {
    if (ratio === "free") return null;
    if (ratio === "original") return outputWidth.value / outputHeight.value;
    const [width, height] = ratio.split(":").map(Number);
    return width / height;
  }

  function setCropRatio(ratio: CropRatio) {
    cropRatio.value = ratio;
    if (activeTool.value === "crop") createCropOverlay();
  }

  function clearCropOverlay() {
    if (!canvas) return;
    const editorCanvas = canvas;
    const overlayObjects = [cropShade, cropBox].filter(
      (object): object is FabricRect => object !== null
    );
    const activeObject = editorCanvas.getActiveObject();
    if (activeObject && overlayObjects.some((object) => object === activeObject)) {
      editorCanvas.discardActiveObject();
    }
    overlayObjects.forEach((object) => {
      editorCanvas.remove(object);
      transientObjects.delete(object);
    });
    if (cropShade) cropShade.clipPath = undefined;
    cropShade = null;
    cropShadeClip = null;
    cropBox = null;
    editorCanvas.uniformScaling = false;
    editorCanvas.requestRenderAll();
  }

  function createCropOverlay() {
    if (!canvas || !fabricModule) return;
    clearCropOverlay();
    canvas.discardActiveObject();
    canvas.uniformScaling = cropRatio.value !== "free";

    const inset = 0.06;
    const maxWidth = outputWidth.value * (1 - inset * 2);
    const maxHeight = outputHeight.value * (1 - inset * 2);
    const ratio = ratioValue(cropRatio.value);
    let width = maxWidth;
    let height = maxHeight;
    if (ratio) {
      if (width / height > ratio) width = height * ratio;
      else height = width / ratio;
    }

    const left = (outputWidth.value - width) / 2;
    const top = (outputHeight.value - height) / 2;
    cropShadeClip = new fabricModule.Rect({
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
    cropShade = new fabricModule.Rect({
      evented: false,
      excludeFromExport: true,
      fill: "rgba(4, 7, 11, 0.62)",
      height: outputHeight.value,
      left: 0,
      originX: "left",
      originY: "top",
      selectable: false,
      strokeWidth: 0,
      top: 0,
      width: outputWidth.value,
      clipPath: cropShadeClip
    });
    cropBox = new fabricModule.Rect({
      borderColor: "rgba(241, 244, 248, 0.94)",
      borderScaleFactor: 1.5,
      cornerColor: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      cornerSize: 11,
      cornerStrokeColor: "rgba(4, 7, 11, 0.82)",
      cornerStyle: "rect",
      evented: true,
      excludeFromExport: true,
      fill: "rgba(255, 255, 255, 0.001)",
      hasRotatingPoint: false,
      left,
      lockRotation: true,
      lockScalingFlip: true,
      originX: "left",
      originY: "top",
      padding: 1,
      selectable: true,
      strokeWidth: 0,
      top,
      transparentCorners: false,
      width,
      height
    });
    cropBox.setControlsVisibility({ mtr: false });
    if (ratio) cropBox.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
    cropBox.on("moving", constrainCropBoxDuringTransform);
    cropBox.on("scaling", constrainCropBoxDuringTransform);
    cropBox.on("modified", finalizeCropBoxTransform);
    [cropShade, cropBox].forEach((object) => transientObjects.add(object));
    canvas.add(cropShade, cropBox);
    canvas.setActiveObject(cropBox);
    updateCropControlScale();
    updateCropShade();
    canvas.requestRenderAll();
  }

  function clamp(value: number, minimum: number, maximum: number) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function constrainCropBox(tolerance: number) {
    if (!cropBox) return;

    const ratio = ratioValue(cropRatio.value);
    const maxWidth = outputWidth.value + tolerance * 2;
    const maxHeight = outputHeight.value + tolerance * 2;
    let { width: scaledWidth, height: scaledHeight } = cropSelectionBounds();
    if (ratio && (scaledWidth > maxWidth || scaledHeight > maxHeight)) {
      const factor = Math.min(
        maxWidth / scaledWidth,
        maxHeight / scaledHeight
      );
      cropBox.scaleX *= factor;
      cropBox.scaleY *= factor;
      ({ width: scaledWidth, height: scaledHeight } = cropSelectionBounds());
    } else if (!ratio) {
      if (scaledWidth > maxWidth) cropBox.scaleX *= maxWidth / scaledWidth;
      if (scaledHeight > maxHeight) cropBox.scaleY *= maxHeight / scaledHeight;
      ({ width: scaledWidth, height: scaledHeight } = cropSelectionBounds());
    }

    cropBox.left = clamp(
      cropBox.left,
      -tolerance,
      outputWidth.value - scaledWidth + tolerance
    );
    cropBox.top = clamp(
      cropBox.top,
      -tolerance,
      outputHeight.value - scaledHeight + tolerance
    );
  }

  function constrainCropBoxDuringTransform() {
    const tolerance = CROP_EDGE_TOLERANCE_PX / Math.max(previewScale.value, 0.01);
    constrainCropBox(tolerance);
    updateCropShade();
  }

  function finalizeCropBoxTransform() {
    if (!cropBox) return;
    constrainCropBox(0);
    cropBox.setCoords();
    updateCropShade();
  }

  function cropSelectionBounds() {
    if (!cropBox) return { left: 0, top: 0, width: 0, height: 0 };
    return {
      left: cropBox.left,
      top: cropBox.top,
      width: Math.abs(cropBox.width * cropBox.scaleX),
      height: Math.abs(cropBox.height * cropBox.scaleY)
    };
  }

  function updateCropControlScale() {
    if (!cropBox) return;
    cropBox.set({
      borderScaleFactor: 1.5,
      cornerSize: 11,
      padding: 1
    });
    cropBox.setCoords();
  }

  function updateCropShade() {
    if (!cropBox || !cropShade || !cropShadeClip) return;
    const bounds = cropSelectionBounds();
    const left = clamp(bounds.left, 0, outputWidth.value);
    const top = clamp(bounds.top, 0, outputHeight.value);
    const right = clamp(bounds.left + bounds.width, 0, outputWidth.value);
    const bottom = clamp(bounds.top + bounds.height, 0, outputHeight.value);
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
    canvas?.requestRenderAll();
  }

  async function applyCrop() {
    if (!cropBox) return;
    const bounds = cropSelectionBounds();
    const oldWidth = outputWidth.value;
    const oldHeight = outputHeight.value;
    const x = Math.max(0, Math.round(bounds.left));
    const y = Math.max(0, Math.round(bounds.top));
    const width = Math.max(1, Math.min(oldWidth - x, Math.round(bounds.width)));
    const height = Math.max(1, Math.min(oldHeight - y, Math.round(bounds.height)));
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
    resizePreview();
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

  function dispose() {
    closeTextContextMenu();
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (canvas) void canvas.dispose();
    canvas = null;
    sourceBitmap?.close();
    sourceBitmap = null;
    if (geometryCanvas) {
      geometryCanvas.width = 0;
      geometryCanvas.height = 0;
    }
    geometryCanvas = null;
    if (previewAdjustmentCanvas) {
      previewAdjustmentCanvas.width = 0;
      previewAdjustmentCanvas.height = 0;
    }
    previewAdjustmentCanvas = null;
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
    cropRatio: readonly(cropRatio),
    dirty: readonly(dirty),
    error: readonly(error),
    outputHeight: readonly(outputHeight),
    outputLabel,
    outputWidth: readonly(outputWidth),
    previewHeight: readonly(previewHeight),
    previewWidth: readonly(previewWidth),
    ready: readonly(ready),
    selectedIsText: readonly(selectedIsText),
    textContextMenu: readonly(textContextMenu),
    textBold: readonly(textBold),
    textColor: readonly(textColor),
    textSize: readonly(textSize),
    addText,
    applyCrop,
    applyEdits,
    cancelCrop,
    closeTextContextMenu,
    deleteContextText,
    deleteSelected,
    flip,
    handleKeydown,
    initialize,
    redo,
    reset,
    rotate,
    setAdjustment,
    setBrushColor,
    setBrushSize,
    setCropRatio,
    setTextColor,
    setTextSize,
    setTool,
    toggleTextBold,
    undo
  };
}
