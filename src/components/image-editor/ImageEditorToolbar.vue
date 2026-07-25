<script setup lang="ts">
import {
  Brush,
  Crop,
  Eraser,
  FlipHorizontal2,
  Hand,
  MousePointer2,
  Redo2,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2
} from "lucide-vue-next";
import type { ImageEditorTool } from "./types";

defineProps<{
  activeTool: ImageEditorTool;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  ready: boolean;
}>();

const emit = defineEmits<{
  selectTool: [tool: ImageEditorTool];
  rotate: [direction: "clockwise" | "counterclockwise"];
  flip: [axis: "horizontal" | "vertical"];
  undo: [];
  redo: [];
  reset: [];
  deleteSelected: [];
}>();

const tools: Array<{
  id: ImageEditorTool;
  label: string;
  icon: typeof MousePointer2;
}> = [
  { id: "select", label: "选择", icon: MousePointer2 },
  { id: "pan", label: "拖动", icon: Hand },
  { id: "crop", label: "裁剪", icon: Crop },
  { id: "adjust", label: "调整图片", icon: SlidersHorizontal },
  { id: "text", label: "添加文字", icon: Type },
  { id: "draw", label: "画笔", icon: Brush },
  { id: "erase", label: "橡皮擦", icon: Eraser }
];
</script>

<template>
  <aside
    class="editor-toolbar"
    role="toolbar"
    aria-label="图片编辑工具"
  >
    <div class="editor-tool-group">
      <button
        v-for="tool in tools"
        :key="tool.id"
        class="editor-tool-button"
        :class="{ active: activeTool === tool.id }"
        type="button"
        :data-tooltip="tool.label"
        :aria-label="tool.label"
        :aria-pressed="activeTool === tool.id"
        :disabled="busy || !ready"
        @click="emit('selectTool', tool.id)"
      >
        <component :is="tool.icon" :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="editor-tool-group editor-transform-group" aria-label="几何变换">
      <button
        class="editor-tool-button"
        type="button"
        data-tooltip="向左旋转"
        aria-label="向左旋转"
        :disabled="busy || !ready"
        @click="emit('rotate', 'counterclockwise')"
      >
        <RotateCcw :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        data-tooltip="向右旋转"
        aria-label="向右旋转"
        :disabled="busy || !ready"
        @click="emit('rotate', 'clockwise')"
      >
        <RotateCw :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        data-tooltip="翻转"
        aria-label="水平翻转图片"
        :disabled="busy || !ready"
        @click="emit('flip', 'horizontal')"
      >
        <FlipHorizontal2 :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="editor-tool-group editor-history-group" aria-label="编辑历史">
      <button
        class="editor-tool-button"
        type="button"
        data-tooltip="撤销"
        aria-label="撤销"
        :disabled="busy || !canUndo"
        @click="emit('undo')"
      >
        <Undo2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        data-tooltip="重做"
        aria-label="重做"
        :disabled="busy || !canRedo"
        @click="emit('redo')"
      >
        <Redo2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        data-tooltip="删除所选标注"
        aria-label="删除所选标注"
        :disabled="busy || !ready"
        @click="emit('deleteSelected')"
      >
        <Trash2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        data-tooltip="恢复原图"
        aria-label="恢复原图"
        :disabled="busy || !ready"
        @click="emit('reset')"
      >
        <RefreshCcw :size="18" aria-hidden="true" />
      </button>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.editor-toolbar {
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

.editor-tool-group {
  width: 100%;
  display: grid;
  place-items: stretch;
  gap: 0;
}

.editor-transform-group,
.editor-history-group {
  border-top: 1px solid var(--line);
}

.editor-history-group {
  margin-top: auto;
}

.editor-tool-button {
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
  .editor-toolbar {
    gap: 0;
    padding: 0;
  }

  .editor-tool-button {
    height: 31px;
  }
}
</style>
