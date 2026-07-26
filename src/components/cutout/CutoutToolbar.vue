<script setup lang="ts">
import {
  Hand,
  ImageDown,
  ImageOff,
  LoaderCircle,
  Minus,
  Plus,
  Redo2,
  Scan,
  SquareDashed,
  Trash2,
  Undo2
} from "lucide-vue-next";
import type { CutoutTool } from "@/composables/useCutoutSelection";

defineProps<{
  activeTool: CutoutTool;
  busy: boolean;
  ready: boolean;
  canClear: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoomPercent: number;
  importing: boolean;
  clearing: boolean;
}>();

const emit = defineEmits<{
  selectTool: [tool: CutoutTool];
  clearSelections: [];
  importImage: [];
  clearImage: [];
  undo: [];
  redo: [];
  zoomIn: [];
  zoomOut: [];
  fitPreview: [];
}>();
</script>

<template>
  <aside class="cutout-toolbar" role="toolbar" aria-label="抠图工具">
    <div class="cutout-tool-group">
      <button
        v-for="tool in [
          { id: 'box', label: '框选', icon: SquareDashed },
          { id: 'pan', label: '拖动', icon: Hand }
        ]"
        :key="tool.id"
        class="cutout-tool-button"
        :class="{ active: activeTool === tool.id }"
        type="button"
        :data-tooltip="tool.label"
        :aria-label="tool.label"
        :aria-pressed="activeTool === tool.id"
        :disabled="busy || !ready"
        @click="emit('selectTool', tool.id as CutoutTool)"
      >
        <component :is="tool.icon" :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="cutout-tool-group cutout-image-group" aria-label="图片操作">
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="导入图片"
        aria-label="导入图片"
        :disabled="busy || importing || clearing"
        @click="emit('importImage')"
      >
        <ImageDown v-if="!importing" :size="18" aria-hidden="true" />
        <LoaderCircle v-else :size="18" aria-hidden="true" />
      </button>
      <button
        class="cutout-tool-button cutout-clear-button"
        type="button"
        data-tooltip="清空图片"
        aria-label="清空图片"
        :disabled="busy || importing || clearing || !ready"
        @click="emit('clearImage')"
      >
        <ImageOff v-if="!clearing" :size="18" aria-hidden="true" />
        <LoaderCircle v-else :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="cutout-tool-group cutout-zoom-group" aria-label="画布缩放">
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="缩小画布"
        aria-label="缩小画布"
        :disabled="busy || !ready || zoomPercent <= 25"
        @click="emit('zoomOut')"
      >
        <Minus :size="18" aria-hidden="true" />
      </button>
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="适应画布"
        aria-label="适应画布"
        :disabled="busy || !ready"
        @click="emit('fitPreview')"
      >
        <Scan :size="18" aria-hidden="true" />
      </button>
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="放大画布"
        aria-label="放大画布"
        :disabled="busy || !ready || zoomPercent >= 400"
        @click="emit('zoomIn')"
      >
        <Plus :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="cutout-tool-group cutout-history-group" aria-label="选区操作">
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="撤销"
        aria-label="撤销"
        :disabled="busy || !canUndo"
        @click="emit('undo')"
      >
        <Undo2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="重做"
        aria-label="重做"
        :disabled="busy || !canRedo"
        @click="emit('redo')"
      >
        <Redo2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="清除全部选区"
        aria-label="清除全部选区"
        :disabled="busy || !canClear"
        @click="emit('clearSelections')"
      >
        <Trash2 :size="18" aria-hidden="true" />
      </button>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.cutout-toolbar {
  position: relative;
  z-index: 2;
  width: 44px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  padding: 0;
  border-right: 1px solid var(--line);
  background: var(--surface);
}

.cutout-tool-group {
  width: 100%;
  display: grid;
  place-items: stretch;
  gap: 0;
}

.cutout-zoom-group,
.cutout-history-group {
  border-top: 1px solid var(--line);
}

.cutout-image-group {
  border-top: 1px solid var(--line);
}

.cutout-history-group {
  margin-top: auto;
}

.cutout-tool-button {
  position: relative;
  width: 100%;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0;
  color: var(--muted);
  background: transparent;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease;

  &::after {
    content: attr(data-tooltip);
    position: absolute;
    z-index: 30;
    top: 50%;
    left: calc(100% + 6px);
    width: max-content;
    max-width: 180px;
    padding: 5px 7px;
    border: 1px solid var(--line-strong);
    border-radius: 5px;
    color: var(--text);
    background: rgba(16, 22, 29, 0.98);
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.34);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-50%);
    visibility: hidden;
    white-space: nowrap;
  }

  &:hover::after,
  &:focus-visible::after {
    opacity: 1;
    visibility: visible;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    color: var(--text);
    background: var(--surface-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  &.active {
    border-left-color: var(--accent);
    color: var(--accent-strong);
    background: var(--accent-soft);
  }

  &:disabled {
    cursor: not-allowed;

    > svg {
      opacity: 0.38;
    }
  }
}

@media (max-height: 760px) {
  .cutout-tool-button {
    height: 31px;
  }
}
</style>
