<script setup lang="ts">
import { computed, nextTick, onMounted, shallowRef, useTemplateRef, watch } from "vue";
import { LoaderCircle, X } from "lucide-vue-next";
import CutoutToolbar from "./CutoutToolbar.vue";
import { useCutoutSelection, type CutoutTool } from "@/composables/useCutoutSelection";
import type { CutoutSelectionBox } from "@/types";

const props = withDefaults(defineProps<{
  source: { blob: Blob; mimeType: string } | null;
  importing?: boolean;
  clearing?: boolean;
  locked?: boolean;
}>(), {
  importing: false,
  clearing: false,
  locked: false
});

const emit = defineEmits<{
  selectionsChange: [selections: CutoutSelectionBox[]];
  ready: [payload: { source: CanvasImageSource; width: number; height: number }];
  import: [];
  clear: [];
  dropFile: [file: File];
}>();

const viewport = useTemplateRef<HTMLElement>("viewport");
const baseCanvas = useTemplateRef<HTMLCanvasElement>("baseCanvas");
const dragDepth = shallowRef(0);
const canvas = useCutoutSelection(props.source);

const stackStyle = computed(() => ({
  width: `${canvas.previewWidth.value}px`,
  height: `${canvas.previewHeight.value}px`,
  transform: `translate(calc(-50% + ${canvas.panX.value}px), calc(-50% + ${canvas.panY.value}px))`
}));

watch(
  () => canvas.selections.value,
  (next) => emit("selectionsChange", [...next]),
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

function handleCanvasPointerDown(event: PointerEvent) {
  if (props.locked || event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("[data-selection-action]")) return;

  const started = canvas.activeTool.value === "pan"
    ? canvas.startPan(event.clientX, event.clientY)
    : canvas.beginBoxFromClient(event.clientX, event.clientY);
  if (!started) return;
  event.preventDefault();
  viewport.value?.setPointerCapture(event.pointerId);
}

function handleCanvasPointerMove(event: PointerEvent) {
  if (props.locked) return;
  if (canvas.panning.value) {
    event.preventDefault();
    canvas.movePan(event.clientX, event.clientY);
    return;
  }
  if (canvas.draftBox.value) {
    event.preventDefault();
    canvas.updateBoxFromClient(event.clientX, event.clientY);
  }
}

function handleCanvasPointerUp(event: PointerEvent) {
  if (props.locked) {
    canvas.endPan();
    canvas.cancelBox();
  } else if (canvas.panning.value) {
    canvas.endPan();
  } else if (canvas.draftBox.value) {
    canvas.finishBox();
  }
  if (viewport.value?.hasPointerCapture(event.pointerId)) {
    viewport.value.releasePointerCapture(event.pointerId);
  }
}

function handleCanvasPointerCancel(event: PointerEvent) {
  canvas.endPan();
  canvas.cancelBox();
  if (viewport.value?.hasPointerCapture(event.pointerId)) {
    viewport.value.releasePointerCapture(event.pointerId);
  }
}

function handleLostPointerCapture() {
  canvas.endPan();
  canvas.cancelBox();
}

function handleKeydown(event: KeyboardEvent) {
  if (props.locked) return;
  if (event.key === "Escape" && canvas.draftBox.value) {
    event.preventDefault();
    canvas.cancelBox();
    return;
  }
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
  event.preventDefault();
  if (event.shiftKey) canvas.redo();
  else canvas.undo();
}

function selectTool(tool: CutoutTool) {
  canvas.setTool(tool);
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
        @select-tool="selectTool"
        @clear-selections="canvas.clearSelections"
        @import-image="emit('import')"
        @clear-image="emit('clear')"
        @undo="canvas.undo"
        @redo="canvas.redo"
        @zoom-in="canvas.zoomIn"
        @zoom-out="canvas.zoomOut"
        @fit-preview="canvas.fitPreview"
      />

      <main
        ref="viewport"
        class="cutout-canvas-viewport"
        :class="{
          'is-empty': !canvas.ready.value,
          'is-dragging-file': dragDepth > 0,
          'is-pan-tool': canvas.ready.value && canvas.activeTool.value === 'pan',
          'is-box-tool': canvas.ready.value && canvas.activeTool.value === 'box',
          'is-panning': canvas.panning.value,
          'is-locked': locked
        }"
        aria-label="抠图画布"
        tabindex="0"
        @pointerdown="handleCanvasPointerDown"
        @pointermove="handleCanvasPointerMove"
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
          <div class="cutout-selection-layer" aria-label="框选区域">
            <div
              v-for="(selection, index) in canvas.selections.value"
              :key="selection.id"
              class="cutout-selection-box"
              :style="selectionStyle(selection)"
            >
              <span class="cutout-selection-badge" aria-hidden="true">{{ index + 1 }}</span>
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

.cutout-selection-layer {
  position: absolute;
  inset: 0;
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

  &.is-draft {
    border-style: dashed;
    background: rgba(120, 152, 245, 0.18);
  }
}

.cutout-selection-badge {
  position: absolute;
  z-index: 1;
  top: 3px;
  left: 3px;
  min-width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border: 1px solid rgba(4, 7, 11, 0.5);
  border-radius: 4px;
  color: #0a0f15;
  background: var(--accent);
  font-size: 10px;
  font-weight: 750;
  line-height: 1;
  font-variant-numeric: tabular-nums;
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
  pointer-events: auto;

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
