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

type FabricModule = typeof import("fabric");

interface EditorElements {
  annotationCanvas: HTMLCanvasElement;
  baseCanvas: HTMLCanvasElement;
  viewport: HTMLElement;
}

interface EditorSnapshot {
  document: ImageEditorDocument;
  signature: string;
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

function imageFilter(adjustments: ImageEditorDocument["adjustments"]) {
  return [
    `brightness(${100 + adjustments.brightness}%)`,
    `contrast(${100 + adjustments.contrast}%)`,
    `saturate(${100 + adjustments.saturation}%)`
  ].join(" ");
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
  const brushColor = shallowRef("#F1F4F8");
  const brushSize = shallowRef(8);
  const textColor = shallowRef("#F1F4F8");
  const textSize = shallowRef(54);
  const textBold = shallowRef(false);
  const adjustments = reactive({
    brightness: 0,
    contrast: 0,
    saturation: 0
  });

  let fabricModule: FabricModule | null = null;
  let canvas: FabricCanvas | null = null;
  let baseCanvas: HTMLCanvasElement | null = null;
  let viewport: HTMLElement | null = null;
  let sourceBitmap: ImageBitmap | null = null;
  let geometryCanvas: HTMLCanvasElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let cropBox: FabricRect | null = null;
  let cropShades: FabricRect[] = [];
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
        import("fabric"),
        createImageBitmap(source.blob)
      ]);
      fabricModule = module;
      sourceBitmap = bitmap;

      canvas = new module.Canvas(elements.annotationCanvas, {
        backgroundColor: "transparent",
        enableRetinaScaling: true,
        preserveObjectStacking: true,
        selection: true,
        uniformScaling: false
      });
      bindCanvasEvents();

      const initialDocument = cloneDocument(
        source.document ?? createEmptyImageEditorDocument()
      );
      operations = initialDocument.operations;
      Object.assign(adjustments, initialDocument.adjustments);
      await rebuildGeometryCanvas();
      await loadAnnotations(initialDocument.annotations);
      resizePreview();
      renderBasePreview();
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
    activeTool.value = "select";
    operations = cloneDocument(snapshot.document).operations;
    Object.assign(adjustments, snapshot.document.adjustments);
    await rebuildGeometryCanvas();
    await loadAnnotations(snapshot.document.annotations);
    resizePreview();
    renderBasePreview();
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
    const scale = Math.max(previewScale.value, 0.01);
    const isEraser = object.globalCompositeOperation === "destination-out";
    object.set({
      borderColor: accent,
      cornerColor: accent,
      cornerSize: 10 / scale,
      cornerStyle: "rect",
      padding: 3 / scale,
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
    let current = document.createElement("canvas");
    current.width = sourceBitmap.width;
    current.height = sourceBitmap.height;
    current.getContext("2d")?.drawImage(sourceBitmap, 0, 0);

    for (const operation of operations) {
      const next = document.createElement("canvas");
      const context = next.getContext("2d");
      if (!context) throw new Error("当前设备无法处理该图片。");

      if (operation.type === "rotate") {
        next.width = current.height;
        next.height = current.width;
        if (operation.direction === "clockwise") {
          context.translate(next.width, 0);
          context.rotate(Math.PI / 2);
        } else {
          context.translate(0, next.height);
          context.rotate(-Math.PI / 2);
        }
        context.drawImage(current, 0, 0);
      } else if (operation.type === "flip") {
        next.width = current.width;
        next.height = current.height;
        if (operation.axis === "horizontal") {
          context.translate(next.width, 0);
          context.scale(-1, 1);
        } else {
          context.translate(0, next.height);
          context.scale(1, -1);
        }
        context.drawImage(current, 0, 0);
      } else {
        const x = Math.max(0, Math.round(operation.x * current.width));
        const y = Math.max(0, Math.round(operation.y * current.height));
        const width = Math.max(
          1,
          Math.min(current.width - x, Math.round(operation.width * current.width))
        );
        const height = Math.max(
          1,
          Math.min(current.height - y, Math.round(operation.height * current.height))
        );
        next.width = width;
        next.height = height;
        context.drawImage(current, x, y, width, height, 0, 0, width, height);
      }
      current = next;
    }

    geometryCanvas = current;
    outputWidth.value = current.width;
    outputHeight.value = current.height;
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
    updateCropControlScale();
    renderBasePreview();
    canvas.requestRenderAll();
  }

  function renderBasePreview() {
    if (!baseCanvas || !geometryCanvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    baseCanvas.width = Math.max(1, Math.floor(previewWidth.value * dpr));
    baseCanvas.height = Math.max(1, Math.floor(previewHeight.value * dpr));
    baseCanvas.style.width = `${previewWidth.value}px`;
    baseCanvas.style.height = `${previewHeight.value}px`;
    const context = baseCanvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, previewWidth.value, previewHeight.value);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.filter = imageFilter(adjustments);
    context.drawImage(geometryCanvas, 0, 0, previewWidth.value, previewHeight.value);
    context.filter = "none";
  }

  function setTool(tool: ImageEditorTool) {
    if (!canvas || !ready.value && tool !== "select") return;
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
    canvas.defaultCursor = drawing ? "crosshair" : "default";
    canvas.requestRenderAll();
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
    if (activeTool.value === "draw" && canvas) canvas.freeDrawingBrush = createBrush(false);
  }

  function setBrushSize(size: number) {
    brushSize.value = size;
    if ((activeTool.value === "draw" || activeTool.value === "erase") && canvas) {
      canvas.freeDrawingBrush = createBrush(activeTool.value === "erase");
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
    adjustments[adjustment] = Math.max(-100, Math.min(100, Math.round(value)));
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
    cropShades.forEach((shade) => canvas?.remove(shade));
    if (cropBox) canvas.remove(cropBox);
    cropShades = [];
    cropBox = null;
    transientObjects.clear();
    canvas.uniformScaling = false;
    canvas.requestRenderAll();
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

    cropShades = Array.from({ length: 4 }, () =>
      new fabricModule!.Rect({
        evented: false,
        excludeFromExport: true,
        fill: "rgba(4, 7, 11, 0.62)",
        selectable: false,
        strokeWidth: 0
      })
    );
    cropBox = new fabricModule.Rect({
      cornerColor: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      cornerStyle: "rect",
      evented: true,
      excludeFromExport: true,
      fill: "rgba(255, 255, 255, 0.001)",
      hasRotatingPoint: false,
      left: (outputWidth.value - width) / 2,
      lockRotation: true,
      lockScalingFlip: true,
      originX: "left",
      originY: "top",
      selectable: true,
      stroke: "rgba(241, 244, 248, 0.92)",
      strokeUniform: true,
      top: (outputHeight.value - height) / 2,
      transparentCorners: false,
      width,
      height
    });
    cropBox.setControlsVisibility({ mtr: false });
    if (ratio) cropBox.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
    cropBox.on("moving", constrainCropBox);
    cropBox.on("scaling", constrainCropBox);
    cropBox.on("modified", updateCropShades);
    [...cropShades, cropBox].forEach((object) => transientObjects.add(object));
    canvas.add(...cropShades, cropBox);
    canvas.setActiveObject(cropBox);
    updateCropControlScale();
    updateCropShades();
    canvas.requestRenderAll();
  }

  function constrainCropBox() {
    if (!cropBox) return;
    let { width: scaledWidth, height: scaledHeight } = cropSelectionBounds();
    if (scaledWidth > outputWidth.value || scaledHeight > outputHeight.value) {
      const factor = Math.min(
        outputWidth.value / scaledWidth,
        outputHeight.value / scaledHeight
      );
      cropBox.scaleX *= factor;
      cropBox.scaleY *= factor;
      ({ width: scaledWidth, height: scaledHeight } = cropSelectionBounds());
    }
    cropBox.left = Math.max(
      0,
      Math.min(cropBox.left, outputWidth.value - scaledWidth)
    );
    cropBox.top = Math.max(
      0,
      Math.min(cropBox.top, outputHeight.value - scaledHeight)
    );
    cropBox.setCoords();
    updateCropShades();
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
    const scale = Math.max(previewScale.value, 0.01);
    cropBox.set({
      cornerSize: 11 / scale,
      padding: 1 / scale,
      strokeWidth: 1.5 / scale
    });
    cropBox.setCoords();
  }

  function updateCropShades() {
    if (!cropBox || cropShades.length !== 4) return;
    const bounds = cropSelectionBounds();
    const left = Math.max(0, bounds.left);
    const top = Math.max(0, bounds.top);
    const right = Math.min(outputWidth.value, left + bounds.width);
    const bottom = Math.min(outputHeight.value, top + bounds.height);
    const layouts = [
      { left: 0, top: 0, width: outputWidth.value, height: top },
      { left: 0, top: bottom, width: outputWidth.value, height: outputHeight.value - bottom },
      { left: 0, top, width: left, height: bottom - top },
      { left: right, top, width: outputWidth.value - right, height: bottom - top }
    ];
    cropShades.forEach((shade, index) => {
      shade.set(layouts[index]);
      shade.setCoords();
    });
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
    clearCropOverlay();
    operations = [];
    Object.assign(adjustments, { brightness: 0, contrast: 0, saturation: 0 });
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
    objects.forEach((object) => canvas?.remove(object));
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
    if (!geometryCanvas) throw new Error("图片编辑器尚未加载完成。");
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
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.filter = imageFilter(adjustments);
      context.drawImage(geometryCanvas, 0, 0);
      context.filter = "none";
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
    textBold: readonly(textBold),
    textColor: readonly(textColor),
    textSize: readonly(textSize),
    addText,
    applyCrop,
    applyEdits,
    cancelCrop,
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
