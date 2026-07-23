<script setup lang="ts">
import {
  Brush,
  Crop,
  Eraser,
  FlipHorizontal2,
  FlipVertical2,
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
  { id: "select", label: "选择和移动", icon: MousePointer2 },
  { id: "crop", label: "裁剪", icon: Crop },
  { id: "adjust", label: "调整图片", icon: SlidersHorizontal },
  { id: "text", label: "添加文字", icon: Type },
  { id: "draw", label: "画笔", icon: Brush },
  { id: "erase", label: "橡皮擦", icon: Eraser }
];
</script>

<template>
  <aside class="editor-toolbar" role="toolbar" aria-label="图片编辑工具">
    <div class="editor-tool-group">
      <button
        v-for="tool in tools"
        :key="tool.id"
        class="editor-tool-button"
        :class="{ active: activeTool === tool.id }"
        type="button"
        :title="tool.label"
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
        title="向左旋转"
        aria-label="向左旋转"
        :disabled="busy || !ready"
        @click="emit('rotate', 'counterclockwise')"
      >
        <RotateCcw :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        title="向右旋转"
        aria-label="向右旋转"
        :disabled="busy || !ready"
        @click="emit('rotate', 'clockwise')"
      >
        <RotateCw :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        title="水平翻转"
        aria-label="水平翻转"
        :disabled="busy || !ready"
        @click="emit('flip', 'horizontal')"
      >
        <FlipHorizontal2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        title="垂直翻转"
        aria-label="垂直翻转"
        :disabled="busy || !ready"
        @click="emit('flip', 'vertical')"
      >
        <FlipVertical2 :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="editor-tool-group editor-history-group" aria-label="编辑历史">
      <button
        class="editor-tool-button"
        type="button"
        title="撤销"
        aria-label="撤销"
        :disabled="busy || !canUndo"
        @click="emit('undo')"
      >
        <Undo2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        title="重做"
        aria-label="重做"
        :disabled="busy || !canRedo"
        @click="emit('redo')"
      >
        <Redo2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        title="删除所选标注"
        aria-label="删除所选标注"
        :disabled="busy || !ready"
        @click="emit('deleteSelected')"
      >
        <Trash2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="editor-tool-button"
        type="button"
        title="恢复原图"
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
  width: 54px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 10px 8px;
  border-right: 1px solid var(--line);
  background: var(--surface);
}

.editor-tool-group {
  width: 100%;
  display: grid;
  place-items: center;
  gap: 5px;
}

.editor-transform-group,
.editor-history-group {
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.editor-history-group {
  margin-top: auto;
}

.editor-tool-button {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--muted);
  background: transparent;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: var(--line-strong);
    color: var(--text);
    background: var(--surface-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  &.active {
    border-color: var(--accent-border);
    color: var(--accent-strong);
    background: var(--accent-soft);
  }

  &:disabled {
    opacity: 0.38;
  }
}

@media (max-height: 760px) {
  .editor-toolbar {
    gap: 6px;
    padding-block: 7px;
  }

  .editor-tool-button {
    width: 32px;
    height: 32px;
  }

  .editor-transform-group,
  .editor-history-group {
    padding-top: 6px;
  }
}
</style>
