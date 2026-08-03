<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, useTemplateRef, watch } from "vue";
import { LoaderCircle, X } from "lucide-vue-next";
import CutoutToolbar from "./CutoutToolbar.vue";
import { useCutoutSelection, type CutoutTool } from "@/composables/useCutoutSelection";
import { cloneCutoutSelections } from "@/services/cutoutSelectionModel";
import { pointInCutoutPolygon } from "@/services/cutoutSelectionShape";
import type {
  CutoutSelection,
  CutoutSelectionBox
} from "@/types";

const props = withDefaults(defineProps<{
  source: { blob: Blob; mimeType: string } | null;
  initialSelections?: CutoutSelection[];
  importing?: boolean;
  clearing?: boolean;
  locked?: boolean;
  mode?: "cutout" | "auto-layer";
}>(), {
  initialSelections: () => [],
  importing: false,
  clearing: false,
  locked: false,
  mode: "cutout"
});

const emit = defineEmits<{
  selectionsChange: [selections: CutoutSelection[]];
  ready: [payload: { source: CanvasImageSource; width: number; height: number }];
  import: [];
  clear: [];
  dropFile: [file: File];
}>();

const viewport = useTemplateRef<HTMLElement>("viewport");
const baseCanvas = useTemplateRef<HTMLCanvasElement>("baseCanvas");
const dragDepth = shallowRef(0);
const brushCursor = shallowRef<{ x: number; y: number } | null>(null);
const hoveredSelectionId = shallowRef<string | null>(null);
const canvas = useCutoutSelection(props.source, props.initialSelections);

const stackStyle = computed(() => ({
  width: `${canvas.previewWidth.value}px`,
  height: `${canvas.previewHeight.value}px`,
  transform: `translate(calc(-50% + ${canvas.panX.value}px), calc(-50% + ${canvas.panY.value}px))`
}));
const polygonSelections = computed(() =>
  canvas.selections.value.filter((selection) => Boolean(selection.polygon?.length))
);
const draftPolygonPoints = computed(() => {
  const points = canvas.draftPolygon.value;
  const cursor = canvas.polygonCursor.value;
  return cursor && points.length ? [...points, cursor] : points;
});
const polygonCloseReady = computed(() => {
  const points = canvas.draftPolygon.value;
  const cursor = canvas.polygonCursor.value;
  if (points.length < 3 || !cursor) return false;
  return Math.hypot(points[0].x - cursor.x, points[0].y - cursor.y) <=
    10 / Math.max(canvas.previewScale.value, 0.01);
});

watch(
  () => canvas.selections.value,
  (next) => {
    emit("selectionsChange", cloneCutoutSelections(next));
    if (hoveredSelectionId.value && !next.some(({ id }) => id === hoveredSelectionId.value)) {
      hoveredSelectionId.value = null;
    }
    if (!next.length) brushCursor.value = null;
  },
  { deep: false }
);

onMounted(async () => {
  await nextTick();
  if (!baseCanvas.value || !viewport.value) return;
  await canvas.initialize({
    baseCanvas: baseCanvas.value,
    viewport: viewport.value
  });
  if (canvas.ready.value) {
    const inferred = canvas.imageSourceForInference();
    if (inferred) emit("ready", inferred);
  }
});

function selectionStyle(selection: CutoutSelectionBox) {
  const scale = canvas.previewScale.value;
  return {
    left: `${selection.x * scale}px`,
    top: `${selection.y * scale}px`,
    width: `${selection.width * scale}px`,
    height: `${selection.height * scale}px`
  };
}

function strokePoints(stroke: {
  readonly points: readonly { readonly x: number; readonly y: number }[];
}) {
  return stroke.points.map((point) => `${point.x},${point.y}`).join(" ");
}

function polygonPoints(points: readonly { readonly x: number; readonly y: number }[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function visibleStrokes() {
  return canvas.selections.value.flatMap((selection) =>
    selection.removalStrokes.map((stroke) => ({ selectionId: selection.id, stroke }))
  );
}

function selectionContainsPoint(
  selection: CutoutSelection,
  point: { x: number; y: number }
) {
  if (selection.polygon?.length) {
    return pointInCutoutPolygon(point, selection.polygon);
  }
  return point.x >= selection.x && point.y >= selection.y &&
    point.x <= selection.x + selection.width &&
    point.y <= selection.y + selection.height;
}

function selectionFromPointer(event: PointerEvent) {
  const selectionElement = (event.target as Element | null)
    ?.closest<HTMLElement>("[data-selection-id]");
  const explicitId = selectionElement?.dataset.selectionId;
  if (explicitId) {
    return canvas.selections.value.find(({ id }) => id === explicitId) ?? null;
  }
  return canvas.selectionAtClientPoint(event.clientX, event.clientY);
}

function updatePointerState(event: PointerEvent) {
  if (props.locked) {
    hoveredSelectionId.value = null;
    brushCursor.value = null;
    return;
  }

  canvas.updatePolygonCursorFromClient(event.clientX, event.clientY);

  const point = canvas.clientToImage(event.clientX, event.clientY);
  if (!point.inside) {
    hoveredSelectionId.value = null;
    brushCursor.value = null;
    return;
  }

  const activeSelection = canvas.activeSelection.value;
  if (canvas.activeTool.value === "erase" && canvas.draftStroke.value) {
    hoveredSelectionId.value = activeSelection?.id ?? null;
    brushCursor.value = activeSelection?.behavior === "background" &&
      selectionContainsPoint(activeSelection, point)
      ? { x: point.x, y: point.y }
      : null;
    return;
  }

  if (canvas.draftBox.value || canvas.draftPolygon.value.length ||
    canvas.movingSelectionId.value || canvas.panning.value) {
    hoveredSelectionId.value = null;
    brushCursor.value = null;
    return;
  }

  const hoveredSelection = selectionFromPointer(event);
  hoveredSelectionId.value = hoveredSelection?.id ?? null;
  if (canvas.activeTool.value !== "erase") {
    brushCursor.value = null;
    return;
  }

  const overSelectionControl = Boolean(
    (event.target as Element | null)?.closest("[data-selection-action]")
  );
  brushCursor.value = !overSelectionControl &&
    hoveredSelection?.id === activeSelection?.id &&
    activeSelection?.behavior === "background"
    ? { x: point.x, y: point.y }
    : null;
}

function handleCanvasPointerDown(event: PointerEvent) {
  if (props.locked || event.button !== 0) return;
  viewport.value?.focus({ preventScroll: true });
  const target = event.target as HTMLElement | null;
  const selectionAction = target?.closest("[data-selection-action]");
  const moveHandle = target?.closest<HTMLElement>("[data-selection-move-id]");
  if (moveHandle && ["box", "polygon", "text-box"].includes(canvas.activeTool.value)) {
    const selectionId = moveHandle.dataset.selectionMoveId;
    const started = selectionId
      ? canvas.beginMoveSelection(selectionId, event.clientX, event.clientY)
      : false;
    if (started) {
      event.preventDefault();
      viewport.value?.setPointerCapture(event.pointerId);
    }
    return;
  }
  if (selectionAction) return;

  let started = false;
  if (canvas.activeTool.value === "pan") {
    started = canvas.startPan(event.clientX, event.clientY);
  } else if (canvas.activeTool.value === "polygon") {
    if (event.detail > 1 && canvas.draftPolygon.value.length >= 3) {
      started = canvas.finishPolygon();
    } else {
      started = canvas.addPolygonPointFromClient(event.clientX, event.clientY);
    }
  } else if (canvas.activeTool.value === "erase") {
    const selection = selectionFromPointer(event);
    if (!selection) return;
    if (selection.id !== canvas.activeSelectionId.value) {
      canvas.selectSelection(selection.id);
      hoveredSelectionId.value = selection.id;
      brushCursor.value = null;
      return;
    }
    started = canvas.beginStrokeFromClient(event.clientX, event.clientY);
  } else {
    started = canvas.beginBoxFromClient(event.clientX, event.clientY);
  }
  if (!started) return;
  event.preventDefault();
  if (canvas.activeTool.value === "polygon") return;
  viewport.value?.setPointerCapture(event.pointerId);
}

function handleCanvasPointerMove(event: PointerEvent) {
  updatePointerState(event);
  if (props.locked) return;
  if (canvas.panning.value) {
    event.preventDefault();
    canvas.movePan(event.clientX, event.clientY);
    return;
  }
  if (canvas.movingSelectionId.value) {
    event.preventDefault();
    canvas.moveSelectionFromClient(event.clientX, event.clientY);
    return;
  }
  if (canvas.draftBox.value) {
    event.preventDefault();
    canvas.updateBoxFromClient(event.clientX, event.clientY);
  }
  if (canvas.draftStroke.value) {
    event.preventDefault();
    canvas.updateStrokeFromClient(event.clientX, event.clientY);
  }
}

function handleCanvasPointerLeave() {
  hoveredSelectionId.value = null;
  brushCursor.value = null;
  canvas.clearPolygonCursor();
}

function handleCanvasPointerUp(event: PointerEvent) {
  if (props.locked) {
    canvas.endPan();
    canvas.cancelBox();
    canvas.cancelMoveSelection();
  } else if (canvas.panning.value) {
    canvas.endPan();
  } else if (canvas.movingSelectionId.value) {
    canvas.finishMoveSelection();
  } else if (canvas.draftBox.value) {
    canvas.finishBox();
  } else if (canvas.draftStroke.value) {
    canvas.finishStroke();
  }
  if (viewport.value?.hasPointerCapture(event.pointerId)) {
    viewport.value.releasePointerCapture(event.pointerId);
  }
}

function handleCanvasPointerCancel(event: PointerEvent) {
  canvas.endPan();
  canvas.cancelBox();
  canvas.cancelStroke();
  canvas.cancelMoveSelection();
  if (viewport.value?.hasPointerCapture(event.pointerId)) {
    viewport.value.releasePointerCapture(event.pointerId);
  }
}

function handleLostPointerCapture() {
  canvas.endPan();
  canvas.cancelBox();
  canvas.cancelStroke();
  canvas.cancelMoveSelection();
}

function handleKeydown(event: KeyboardEvent) {
  if (props.locked) return;
  if (event.key === "Escape" && canvas.draftPolygon.value.length) {
    event.preventDefault();
    canvas.cancelPolygon();
    return;
  }
  if (event.key === "Enter" && canvas.draftPolygon.value.length >= 3) {
    event.preventDefault();
    canvas.finishPolygon();
    return;
  }
  if (event.key === "Backspace" && canvas.draftPolygon.value.length) {
    event.preventDefault();
    canvas.removeLastPolygonPoint();
    return;
  }
  if (event.key === "Escape" && canvas.draftBox.value) {
    event.preventDefault();
    canvas.cancelBox();
    return;
  }
  if (event.key === "Escape" && canvas.movingSelectionId.value) {
    event.preventDefault();
    canvas.cancelMoveSelection();
    return;
  }
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
  event.preventDefault();
  if (event.shiftKey) canvas.redo();
  else canvas.undo();
}

function selectTool(tool: CutoutTool) {
  hoveredSelectionId.value = null;
  brushCursor.value = null;
  canvas.setTool(tool);
}

function selectSelection(id: string) {
  brushCursor.value = null;
  canvas.selectSelection(id);
}

function handleDragEnter(event: DragEvent) {
  if (props.locked || !event.dataTransfer?.types.includes("Files")) return;
  dragDepth.value += 1;
}

function handleDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
}

function handleDrop(event: DragEvent) {
  dragDepth.value = 0;
  if (props.locked) return;
  const file = event.dataTransfer?.files?.[0];
  if (file) emit("dropFile", file);
}

function handleWheel(event: WheelEvent) {
  if (!props.locked) canvas.zoomFromWheel(event);
}
</script>

<template>
  <section
    class="cutout-shell"
    role="region"
    aria-label="AI 抠图画布"
    :aria-busy="canvas.busy.value || locked"
  >
    <div class="cutout-workspace">
      <CutoutToolbar
        :active-tool="canvas.activeTool.value"
        :busy="canvas.busy.value || locked"
        :ready="canvas.ready.value"
        :can-clear="canvas.canClear.value"
        :can-undo="canvas.canUndo.value"
        :can-redo="canvas.canRedo.value"
        :zoom-percent="canvas.zoomPercent.value"
        :importing="importing"
        :clearing="clearing"
        :active-selection="canvas.activeSelection.value"
        :brush-operation="canvas.brushOperation.value"
        :brush-radius="canvas.brushRadius.value"
        :smart-brush="canvas.smartBrush.value"
        :mode="mode"
        @select-tool="selectTool"
        @clear-selections="canvas.clearSelections"
        @import-image="emit('import')"
        @clear-image="emit('clear')"
        @undo="canvas.undo"
        @redo="canvas.redo"
        @zoom-in="canvas.zoomIn"
        @zoom-out="canvas.zoomOut"
        @fit-preview="canvas.fitPreview"
        @make-independent="canvas.makeSelectionIndependent"
        @make-background="canvas.makeSelectionBackground"
        @set-brush-operation="canvas.setBrushOperation"
        @set-brush-radius="canvas.setBrushRadius"
        @set-smart-brush="canvas.setSmartBrush"
      />

      <main
        ref="viewport"
        class="cutout-canvas-viewport"
        :class="{
          'is-empty': !canvas.ready.value,
          'is-dragging-file': dragDepth > 0,
          'is-pan-tool': canvas.ready.value && canvas.activeTool.value === 'pan',
          'is-box-tool': canvas.ready.value && ['box', 'text-box'].includes(canvas.activeTool.value),
          'is-polygon-tool': canvas.ready.value && canvas.activeTool.value === 'polygon',
          'is-erase-tool': canvas.ready.value && canvas.activeTool.value === 'erase',
          'is-erase-target': canvas.activeTool.value === 'erase' && hoveredSelectionId && !brushCursor,
          'is-erase-brush-ready': canvas.activeTool.value === 'erase' && brushCursor,
          'is-panning': canvas.panning.value,
          'is-locked': locked
        }"
        aria-label="抠图画布"
        tabindex="0"
        @pointerdown="handleCanvasPointerDown"
        @pointermove="handleCanvasPointerMove"
        @pointerleave="handleCanvasPointerLeave"
        @pointerup="handleCanvasPointerUp"
        @pointercancel="handleCanvasPointerCancel"
        @lostpointercapture="handleLostPointerCapture"
        @wheel.prevent="handleWheel"
        @keydown="handleKeydown"
        @dragenter.prevent="handleDragEnter"
        @dragover.prevent
        @dragleave.prevent="handleDragLeave"
        @drop.prevent="handleDrop"
      >
        <div v-show="canvas.ready.value" class="cutout-canvas-stack" :style="stackStyle">
          <canvas ref="baseCanvas" class="cutout-base-canvas" aria-hidden="true" />
          <svg
            class="cutout-removal-layer"
            :viewBox="`0 0 ${canvas.imageWidth.value} ${canvas.imageHeight.value}`"
            aria-hidden="true"
          >
            <g v-for="item in visibleStrokes()" :key="`${item.selectionId}-${item.stroke.id}`">
              <circle
                v-if="item.stroke.points.length === 1"
                :class="`is-${item.stroke.operation}`"
                :cx="item.stroke.points[0].x"
                :cy="item.stroke.points[0].y"
                :r="item.stroke.radius"
              />
              <polyline
                v-else
                :class="`is-${item.stroke.operation}`"
                :points="strokePoints(item.stroke)"
                :stroke-width="item.stroke.radius * 2"
              />
            </g>
            <g v-if="canvas.draftStroke.value">
              <circle
                v-if="canvas.draftStroke.value.points.length === 1"
                :class="`is-${canvas.draftStroke.value.operation}`"
                :cx="canvas.draftStroke.value.points[0].x"
                :cy="canvas.draftStroke.value.points[0].y"
                :r="canvas.draftStroke.value.radius"
              />
              <polyline
                v-else
                :class="`is-${canvas.draftStroke.value.operation}`"
                :points="strokePoints(canvas.draftStroke.value)"
                :stroke-width="canvas.draftStroke.value.radius * 2"
              />
            </g>
            <circle
              v-if="brushCursor && canvas.activeTool.value === 'erase' && !locked"
              class="cutout-brush-cursor"
              :cx="brushCursor.x"
              :cy="brushCursor.y"
              :r="canvas.brushRadius.value"
            />
          </svg>
          <svg
            class="cutout-polygon-layer"
            :viewBox="`0 0 ${canvas.imageWidth.value} ${canvas.imageHeight.value}`"
            aria-hidden="true"
          >
            <polygon
              v-for="selection in polygonSelections"
              :key="selection.id"
              :class="{
                'is-active': canvas.activeSelectionId.value === selection.id,
                'is-background': selection.behavior === 'background',
                'is-hovered': hoveredSelectionId === selection.id
              }"
              :points="polygonPoints(selection.polygon!)"
            />
            <polygon
              v-if="draftPolygonPoints.length && polygonCloseReady"
              class="is-draft"
              :points="polygonPoints(draftPolygonPoints)"
            />
            <polyline
              v-else-if="draftPolygonPoints.length"
              class="is-draft"
              :points="polygonPoints(draftPolygonPoints)"
            />
            <circle
              v-for="(point, index) in canvas.draftPolygon.value"
              :key="`${point.x}-${point.y}-${index}`"
              :class="{ 'is-start': index === 0, 'is-close-ready': index === 0 && polygonCloseReady }"
              :cx="point.x"
              :cy="point.y"
              :r="index === 0 ? 4 / Math.max(canvas.previewScale.value, 0.01) : 3 / Math.max(canvas.previewScale.value, 0.01)"
            />
          </svg>
          <div class="cutout-selection-layer" aria-label="抠图选区">
            <div
              v-for="(selection, index) in canvas.selections.value"
              :key="selection.id"
              class="cutout-selection-box"
              :class="{
                'is-active': canvas.activeSelectionId.value === selection.id,
                'is-background': selection.behavior === 'background',
                'is-text': selection.layerKind === 'text',
                'is-polygon': Boolean(selection.polygon?.length),
                'is-hovered': hoveredSelectionId === selection.id,
                'is-erase-switch-target': canvas.activeTool.value === 'erase' && hoveredSelectionId === selection.id && canvas.activeSelectionId.value !== selection.id,
                'is-moving': canvas.movingSelectionId.value === selection.id
              }"
              :style="selectionStyle(selection)"
              :data-selection-id="selection.id"
            >
              <span
                v-for="edge in ['top', 'right', 'bottom', 'left']"
                :key="edge"
                class="cutout-selection-edge"
                :class="`is-${edge}`"
                data-selection-action
                :data-selection-move-id="selection.id"
                aria-hidden="true"
                @click.stop="selectSelection(selection.id)"
              />
              <button
                class="cutout-selection-select sr-only"
                type="button"
                :aria-label="`选择选区 ${index + 1}`"
                :aria-pressed="canvas.activeSelectionId.value === selection.id"
                :disabled="locked"
                @click.stop="selectSelection(selection.id)"
              >
                选择选区
              </button>
              <button
                class="cutout-selection-remove"
                type="button"
                data-selection-action
                :aria-label="`删除选区 ${index + 1}`"
                :title="`删除选区 ${index + 1}`"
                :disabled="locked"
                @click.stop="canvas.removeSelection(selection.id)"
              >
                <X :size="12" aria-hidden="true" />
              </button>
            </div>
            <div
              v-if="canvas.draftBox.value"
              class="cutout-selection-box is-draft"
              :style="selectionStyle(canvas.draftBox.value)"
              aria-hidden="true"
            />
          </div>
        </div>

        <div v-if="canvas.busy.value" class="cutout-loading" role="status">
          <LoaderCircle :size="24" aria-hidden="true" />
          <span class="sr-only">正在载入图片</span>
        </div>
      </main>
    </div>

    <p v-if="canvas.error.value" class="cutout-canvas-error" role="alert">
      {{ canvas.error.value }}
    </p>
  </section>
</template>

<style scoped lang="scss">
.cutout-shell {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: grid;
  overflow: hidden;
  background: transparent;
}

.cutout-workspace {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
}

.cutout-canvas-viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  background-color: transparent;
  background-image:
    linear-gradient(45deg, rgba(241, 244, 248, 0.045) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(241, 244, 248, 0.045) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(241, 244, 248, 0.045) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(241, 244, 248, 0.045) 75%);
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
  transition: border-color 160ms ease, background-color 160ms ease;

  &.is-empty {
    cursor: default;
  }

  &.is-dragging-file {
    border-color: var(--accent);
    background-color: var(--accent-soft);
  }

  &.is-pan-tool { cursor: grab; }
  &.is-box-tool { cursor: crosshair; }
  &.is-polygon-tool { cursor: crosshair; }
  &.is-erase-tool { cursor: default; }
  &.is-erase-target { cursor: pointer; }
  &.is-erase-brush-ready { cursor: none; }
  &.is-panning { cursor: grabbing; }
  &.is-locked { cursor: progress; }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }
}

.cutout-canvas-stack {
  position: absolute;
  left: 50%;
  top: 50%;
  min-width: 1px;
  min-height: 1px;
  overflow: hidden;
  box-sizing: content-box;
  border: 1px solid var(--line-strong);
  background-color: #17202a;
  background-image:
    linear-gradient(45deg, rgba(241, 244, 248, 0.07) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(241, 244, 248, 0.07) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(241, 244, 248, 0.07) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(241, 244, 248, 0.07) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  box-shadow: 0 16px 54px rgba(0, 0, 0, 0.42);
  will-change: transform;
}

.cutout-base-canvas {
  position: absolute;
  inset: 0;
  display: block;
}

.cutout-removal-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;

  circle,
  polyline {
    fill: rgba(239, 125, 136, 0.3);
    stroke: rgba(239, 125, 136, 0.5);
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .is-restore {
    fill: rgba(101, 207, 224, 0.26);
    stroke: rgba(101, 207, 224, 0.5);
  }

  .cutout-brush-cursor {
    fill: none;
    stroke: var(--text);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
}

.cutout-polygon-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;

  polygon,
  polyline {
    fill: rgba(120, 152, 245, 0.12);
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }

  polygon.is-background {
    fill: rgba(228, 160, 107, 0.1);
    stroke: var(--warm);
  }

  polygon.is-active,
  polygon.is-hovered {
    stroke: var(--text);
  }

  .is-draft {
    fill: rgba(120, 152, 245, 0.16);
    stroke-dasharray: 5 4;
  }

  circle {
    fill: var(--surface-raised);
    stroke: var(--accent);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;

    &.is-close-ready {
      fill: var(--accent);
      stroke: var(--text);
    }
  }
}

.cutout-selection-edge {
  position: absolute;
  z-index: 1;
  pointer-events: auto;
  cursor: pointer;

  &.is-top,
  &.is-bottom {
    left: 0;
    width: 100%;
    height: 8px;
  }
  &.is-left,
  &.is-right {
    top: 0;
    width: 8px;
    height: 100%;
  }
  &.is-top { top: -4px; }
  &.is-right { right: -4px; }
  &.is-bottom { bottom: -4px; }
  &.is-left { left: -4px; }
}

.cutout-canvas-viewport.is-box-tool .cutout-selection-edge {
  cursor: move;
}

.cutout-selection-box.is-moving .cutout-selection-edge {
  cursor: grabbing;
}

.cutout-selection-layer {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
}

.cutout-selection-box {
  position: absolute;
  min-width: 1px;
  min-height: 1px;
  box-sizing: border-box;
  border: 2px solid var(--accent);
  background: rgba(120, 152, 245, 0.12);
  pointer-events: none;
  transition: background-color 160ms ease, box-shadow 160ms ease;

  &.is-background {
    border-color: var(--warm);
    background: rgba(228, 160, 107, 0.1);
  }

  &.is-active {
    box-shadow: inset 0 0 0 1px var(--text);
  }

  &:focus-within {
    box-shadow: inset 0 0 0 1px var(--text);
  }

  &.is-erase-switch-target {
    background: rgba(120, 152, 245, 0.22);
    box-shadow: inset 0 0 0 1px var(--accent), 0 0 0 1px rgba(120, 152, 245, 0.5);
  }

  &.is-background.is-erase-switch-target {
    background: rgba(228, 160, 107, 0.2);
    box-shadow: inset 0 0 0 1px var(--warm), 0 0 0 1px rgba(228, 160, 107, 0.5);
  }

  &.is-draft {
    border-style: dashed;
    background: rgba(120, 152, 245, 0.18);
  }

  &.is-polygon {
    border: 1px dashed rgba(120, 152, 245, 0.4);
    background: transparent;
  }

  &.is-polygon.is-background {
    border-color: rgba(228, 160, 107, 0.42);
  }
}

.cutout-selection-select {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
  pointer-events: none;
  white-space: nowrap;
}

.cutout-selection-remove {
  position: absolute;
  z-index: 2;
  top: 3px;
  right: 3px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(4, 7, 11, 0.5);
  border-radius: 4px;
  color: var(--text);
  background: rgba(12, 17, 23, 0.86);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
  transition:
    background-color 160ms ease,
    color 160ms ease,
    opacity 160ms ease,
    visibility 0s linear 160ms;

  &:hover:not(:disabled),
  &:focus-visible {
    color: #ffffff;
    background: var(--danger);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.cutout-selection-box.is-hovered .cutout-selection-remove,
.cutout-selection-box:focus-within .cutout-selection-remove {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
  transition-delay: 0s;
}

.cutout-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--accent);
  background: var(--field);

  svg {
    animation: spin 0.9s linear infinite;
  }
}

.cutout-canvas-error {
  position: absolute;
  z-index: 5;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  max-width: min(420px, calc(100% - 32px));
  margin: 0;
  padding: 8px 11px;
  border: 1px solid rgba(239, 125, 136, 0.44);
  border-radius: 6px;
  color: var(--danger);
  background: var(--surface-raised);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
  font-size: 11px;
  font-weight: 600;
}

@media (prefers-reduced-motion: reduce) {
  .cutout-canvas-viewport {
    transition: none;
  }

  .cutout-loading svg {
    animation: none;
  }
}
</style>
