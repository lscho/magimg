<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef
} from "vue";
import { Check, LoaderCircle, X } from "lucide-vue-next";
import ImageEditorInspector from "./ImageEditorInspector.vue";
import ImageEditorTextContextMenu from "./ImageEditorTextContextMenu.vue";
import ImageEditorToolbar from "./ImageEditorToolbar.vue";
import type {
  ImageAdjustment,
  ImageEditorApplyResult,
  ImageEditorSource
} from "./types";
import { useImageEditor } from "./useImageEditor";

const props = defineProps<{
  source: ImageEditorSource;
}>();

const emit = defineEmits<{
  apply: [result: ImageEditorApplyResult];
  close: [];
}>();

const dialog = useTemplateRef<HTMLElement>("dialog");
const viewport = useTemplateRef<HTMLElement>("viewport");
const annotationCanvas = useTemplateRef<HTMLCanvasElement>("annotationCanvas");
const baseCanvas = useTemplateRef<HTMLCanvasElement>("baseCanvas");
const discardDialog = useTemplateRef<HTMLElement>("discardDialog");
const showDiscardConfirm = shallowRef(false);
const editor = useImageEditor(props.source);
const stackStyle = computed(() => ({
  width: `${editor.previewWidth.value}px`,
  height: `${editor.previewHeight.value}px`
}));
let previousBodyOverflow = "";

onMounted(async () => {
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  await nextTick();
  dialog.value?.focus();
  if (!annotationCanvas.value || !baseCanvas.value || !viewport.value) return;
  await editor.initialize({
    annotationCanvas: annotationCanvas.value,
    baseCanvas: baseCanvas.value,
    viewport: viewport.value
  });
});

onBeforeUnmount(() => {
  document.body.style.overflow = previousBodyOverflow;
});

function focusableElements(container: HTMLElement | null) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])"
    )
  ).filter((element) => !element.hasAttribute("hidden"));
}

function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  const focusable = focusableElements(container);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (showDiscardConfirm.value) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelDiscard();
      return;
    }
    if (event.key === "Tab") trapFocus(event, discardDialog.value);
    return;
  }

  if (editor.textContextMenu.value && event.key === "Escape") {
    event.preventDefault();
    closeTextContextMenu(true);
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    requestClose();
    return;
  }
  if (event.key === "Tab") trapFocus(event, dialog.value);
  else editor.handleKeydown(event);
}

function handlePointerDown(event: PointerEvent) {
  if (!editor.textContextMenu.value) return;
  const target = event.target as HTMLElement;
  if (!target.closest("[data-image-editor-text-menu]")) {
    editor.closeTextContextMenu();
  }
}

function closeTextContextMenu(focusCanvas = false) {
  editor.closeTextContextMenu();
  if (focusCanvas) nextTick(() => viewport.value?.focus());
}

function deleteContextText() {
  editor.deleteContextText();
  nextTick(() => viewport.value?.focus());
}

function requestClose() {
  if (editor.busy.value) return;
  editor.closeTextContextMenu();
  if (!editor.dirty.value) {
    emit("close");
    return;
  }
  showDiscardConfirm.value = true;
  nextTick(() => discardDialog.value?.querySelector<HTMLButtonElement>("button")?.focus());
}

function cancelDiscard() {
  showDiscardConfirm.value = false;
  nextTick(() => dialog.value?.focus());
}

function confirmDiscard() {
  showDiscardConfirm.value = false;
  emit("close");
}

async function applyEdits() {
  if (!editor.ready.value || editor.busy.value || !editor.dirty.value) return;
  try {
    emit("apply", await editor.applyEdits());
  } catch {
    // The editor exposes the user-facing export error in the footer.
  }
}

function setAdjustment(adjustment: ImageAdjustment, value: number, commit: boolean) {
  editor.setAdjustment(adjustment, value, commit);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="image-editor" appear>
      <div
        class="image-editor-backdrop"
        @click.self="requestClose"
        @pointerdown.capture="handlePointerDown"
      >
        <section
          ref="dialog"
          class="image-editor-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="image-editor-title"
          :aria-busy="editor.busy.value"
          tabindex="-1"
          @keydown="handleKeydown"
        >
          <header class="image-editor-header">
            <div class="editor-title-block">
              <h2 id="image-editor-title">编辑图片</h2>
              <span>{{ source.fileBaseName }}</span>
            </div>
            <button
              class="icon-button"
              type="button"
              title="关闭编辑器"
              aria-label="关闭编辑器"
              :disabled="editor.busy.value"
              @click="requestClose"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </header>

          <div class="image-editor-workspace">
            <ImageEditorToolbar
              :active-tool="editor.activeTool.value"
              :busy="editor.busy.value"
              :can-undo="editor.canUndo.value"
              :can-redo="editor.canRedo.value"
              :ready="editor.ready.value"
              @select-tool="editor.setTool"
              @rotate="editor.rotate"
              @flip="editor.flip"
              @undo="editor.undo"
              @redo="editor.redo"
              @reset="editor.reset"
              @delete-selected="editor.deleteSelected"
            />

            <main
              ref="viewport"
              class="editor-canvas-viewport"
              aria-label="图片编辑画布"
              tabindex="0"
            >
              <div class="editor-canvas-stack" :style="stackStyle">
                <canvas ref="baseCanvas" class="editor-base-canvas" aria-hidden="true" />
                <canvas ref="annotationCanvas" class="editor-annotation-canvas" />
              </div>
              <div v-if="editor.busy.value && !editor.ready.value" class="editor-loading" role="status">
                <LoaderCircle :size="24" aria-hidden="true" />
                <span>正在载入图片</span>
              </div>
            </main>

            <ImageEditorInspector
              :active-tool="editor.activeTool.value"
              :adjustments="editor.adjustments"
              :brush-color="editor.brushColor.value"
              :brush-size="editor.brushSize.value"
              :busy="editor.busy.value"
              :crop-ratio="editor.cropRatio.value"
              :output-label="editor.outputLabel.value"
              :selected-is-text="editor.selectedIsText.value"
              :text-bold="editor.textBold.value"
              :text-color="editor.textColor.value"
              :text-size="editor.textSize.value"
              @add-text="editor.addText"
              @apply-crop="editor.applyCrop"
              @cancel-crop="editor.cancelCrop"
              @set-adjustment="setAdjustment"
              @set-brush-color="editor.setBrushColor"
              @set-brush-size="editor.setBrushSize"
              @set-crop-ratio="editor.setCropRatio"
              @set-text-color="editor.setTextColor"
              @set-text-size="editor.setTextSize"
              @toggle-text-bold="editor.toggleTextBold"
            />
          </div>

          <ImageEditorTextContextMenu
            v-if="editor.textContextMenu.value"
            :x="editor.textContextMenu.value.x"
            :y="editor.textContextMenu.value.y"
            @close="closeTextContextMenu(true)"
            @delete="deleteContextText"
          />

          <footer class="image-editor-footer">
            <p v-if="editor.error.value" role="alert">{{ editor.error.value }}</p>
            <span v-else>{{ editor.outputLabel.value }} px</span>
            <div class="editor-footer-actions">
              <button class="ghost-button" type="button" :disabled="editor.busy.value" @click="requestClose">
                取消
              </button>
              <button
                class="primary-small apply-edit-button"
                type="button"
                :disabled="!editor.ready.value || !editor.dirty.value || editor.busy.value"
                @click="applyEdits"
              >
                <LoaderCircle v-if="editor.busy.value" class="editor-spinner" :size="16" aria-hidden="true" />
                <Check v-else :size="16" aria-hidden="true" />
                应用编辑
              </button>
            </div>
          </footer>

          <div v-if="showDiscardConfirm" class="discard-overlay">
            <section
              ref="discardDialog"
              class="discard-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="discard-title"
              aria-describedby="discard-description"
              tabindex="-1"
            >
              <h3 id="discard-title">放弃未应用的编辑？</h3>
              <p id="discard-description">当前修改不会保留。</p>
              <div>
                <button class="ghost-button" type="button" @click="cancelDiscard">继续编辑</button>
                <button class="discard-button" type="button" @click="confirmDiscard">放弃编辑</button>
              </div>
            </section>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.image-editor-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(4, 7, 11, 0.86);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

.image-editor-dialog {
  position: relative;
  width: min(1440px, 100%);
  height: min(860px, 100%);
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 58px minmax(0, 1fr) 62px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--bg);
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.58);

  &:focus {
    outline: none;
  }
}

.image-editor-header,
.image-editor-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 0 16px;
  background: var(--surface);
}

.image-editor-header {
  border-bottom: 1px solid var(--line);
}

.editor-title-block {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 12px;

  h2 {
    margin: 0;
    color: var(--text);
    font-size: 17px;
    font-weight: 660;
  }

  span {
    max-width: min(48vw, 560px);
    overflow: hidden;
    color: var(--muted);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.image-editor-workspace {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) 268px;
}

.editor-canvas-viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: var(--field);

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }
}

.editor-canvas-stack {
  position: relative;
  min-width: 1px;
  min-height: 1px;
  overflow: hidden;
  box-sizing: content-box;
  border: 1px solid var(--line-strong);
  background-color: #17202a;
  background-image:
    linear-gradient(45deg, rgba(241, 244, 248, 0.055) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(241, 244, 248, 0.055) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(241, 244, 248, 0.055) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(241, 244, 248, 0.055) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  box-shadow: 0 16px 54px rgba(0, 0, 0, 0.42);

  :deep(.canvas-container) {
    position: absolute !important;
    inset: 0;
  }
}

.editor-base-canvas {
  position: absolute;
  inset: 0;
  display: block;
}

.editor-annotation-canvas {
  position: absolute;
  inset: 0;
}

.editor-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  place-items: center;
  gap: 9px;
  color: var(--soft);
  background: var(--field);
  font-size: 11px;
  font-weight: 600;

  svg {
    color: var(--accent);
    animation: spin 0.9s linear infinite;
  }
}

.image-editor-footer {
  border-top: 1px solid var(--line);

  > p,
  > span {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > p {
    color: var(--danger);
    font-weight: 600;
  }

  > span {
    color: var(--muted);
  }
}

.editor-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.apply-edit-button {
  min-width: 112px;
}

.editor-spinner {
  animation: spin 0.9s linear infinite;
}

.discard-overlay {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 7, 11, 0.72);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.discard-dialog {
  width: min(380px, 100%);
  padding: 22px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.52);

  h3 {
    margin: 0;
    color: var(--text);
    font-size: 16px;
    font-weight: 660;
  }

  p {
    margin: 7px 0 18px;
    color: var(--muted);
    font-size: 11px;
  }

  > div {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  &:focus {
    outline: none;
  }
}

.discard-button {
  min-height: 36px;
  padding: 0 13px;
  border: 1px solid rgba(239, 125, 136, 0.52);
  border-radius: 7px;
  color: var(--text);
  background: var(--danger);
  font-size: 12px;
  font-weight: 650;
}

.image-editor-enter-active,
.image-editor-leave-active {
  transition: opacity 200ms ease;

  .image-editor-dialog {
    transition: transform 200ms ease, opacity 200ms ease;
  }
}

.image-editor-enter-from,
.image-editor-leave-to {
  opacity: 0;

  .image-editor-dialog {
    opacity: 0;
    transform: translateY(10px) scale(0.99);
  }
}

@media (max-width: 900px) {
  .image-editor-backdrop {
    padding: 0;
  }

  .image-editor-dialog {
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 0;
  }

  .image-editor-workspace {
    grid-template-columns: 54px minmax(0, 1fr);
    grid-template-rows: minmax(320px, 1fr) auto;
  }

  .image-editor-workspace :deep(.editor-inspector) {
    grid-column: 1 / -1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .image-editor-enter-active,
  .image-editor-leave-active,
  .image-editor-enter-active .image-editor-dialog,
  .image-editor-leave-active .image-editor-dialog {
    transition: none;
  }
}
</style>
