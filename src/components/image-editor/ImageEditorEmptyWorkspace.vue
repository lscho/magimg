<script setup lang="ts">
import { shallowRef } from "vue";
import ImageEditorToolbar from "./ImageEditorToolbar.vue";

defineProps<{
  selecting: boolean;
}>();

const emit = defineEmits<{
  choose: [];
  dropFile: [file: File];
}>();

const draggingFile = shallowRef(false);
let dragDepth = 0;

function containsFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function handleDragEnter(event: DragEvent) {
  if (!containsFiles(event)) return;
  dragDepth += 1;
  draggingFile.value = true;
}

function handleDragOver(event: DragEvent) {
  if (!containsFiles(event)) return;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  draggingFile.value = true;
}

function handleDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) draggingFile.value = false;
}

function handleDrop(event: DragEvent) {
  dragDepth = 0;
  draggingFile.value = false;
  const file = event.dataTransfer?.files[0];
  if (file) emit("dropFile", file);
}
</script>

<template>
  <section class="empty-editor-shell" aria-label="图片编辑工作台" :aria-busy="selecting">
    <div class="empty-editor-workspace">
      <div class="empty-editor-content">
        <ImageEditorToolbar
          active-tool="select"
          :busy="selecting"
          :can-undo="false"
          :can-redo="false"
          :ready="false"
        />

        <button
          class="empty-canvas-viewport"
          :class="{ 'is-dragging': draggingFile }"
          type="button"
          aria-label="选择或拖放图片"
          :disabled="selecting"
          @click="emit('choose')"
          @dragenter.prevent="handleDragEnter"
          @dragover.prevent="handleDragOver"
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleDrop"
        >
          <span>拖放图片</span>
        </button>
      </div>

      <aside class="empty-editor-sidebar" aria-label="编辑设置">
        <div aria-hidden="true" />
        <div class="empty-sidebar-actions">
          <button class="primary-button" type="button" disabled>应用编辑</button>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped lang="scss">
.empty-editor-shell {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.empty-editor-workspace {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(340px, 23vw, 372px);
}

.empty-editor-content {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
}

.empty-canvas-viewport {
  width: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 0;
  color: var(--muted);
  background-color: transparent;
  background-image:
    linear-gradient(45deg, rgba(241, 244, 248, 0.045) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(241, 244, 248, 0.045) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(241, 244, 248, 0.045) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(241, 244, 248, 0.045) 75%);
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
  cursor: pointer;
  transition: border-color 140ms ease, color 140ms ease;

  &:hover:not(:disabled),
  &:focus-visible,
  &.is-dragging {
    border-color: var(--accent-border);
    color: var(--accent-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }

  > span {
    font-size: 13px;
    font-weight: 650;
  }
}

.empty-editor-sidebar {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  border-left: 1px solid var(--line);
  background: var(--surface);
}

.empty-sidebar-actions {
  padding: 14px 18px 18px;
  border-top: 1px solid var(--line);
  background: var(--surface);

  > button {
    width: 100%;
    min-height: 44px;
  }
}

@media (max-width: 900px) {
  .empty-editor-workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(360px, 1fr) auto;
  }

  .empty-editor-sidebar {
    min-height: 90px;
    border-top: 1px solid var(--line);
    border-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .empty-canvas-viewport {
    transition: none;
  }
}
</style>
