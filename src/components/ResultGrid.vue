<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, shallowRef, useTemplateRef, watch } from "vue";
import {
  Ban,
  Clipboard,
  Download,
  FolderOpen,
  LoaderCircle,
  Pencil,
  RotateCcw
} from "lucide-vue-next";
import GenerationEmptyState from "@/components/GenerationEmptyState.vue";
import ImageEditorModal from "@/components/image-editor/ImageEditorModal.vue";
import ResultImageContextMenu from "@/components/ResultImageContextMenu.vue";
import brandMark from "@/assets/huanhua-mark.svg";
import {
  copyImageBlobToClipboard,
  copyRemoteImageToClipboard,
  imageBlobToSelectedFile,
  loadRemoteImageBlob,
  openDirectory,
  remoteImageToSelectedFile,
  saveImageBlobAs,
  saveRemoteImageAs
} from "@/services/desktop";
import type {
  ImageEditorApplyResult,
  ImageEditorDocument,
  ImageEditorSource
} from "@/components/image-editor/types";
import type {
  GeneratedImage,
  GenerationMode,
  GenerationRecord,
  SelectedImageFile
} from "@/types";

const props = defineProps<{
  record: GenerationRecord | null;
  loading: boolean;
  saveDirectory: string;
  canCancel: boolean;
  recoverableTask: GenerationRecord | null;
  mode: GenerationMode;
}>();

const emit = defineEmits<{
  cancel: [];
  restoreTask: [];
  useAsReference: [image: SelectedImageFile];
}>();

interface DisplayImage extends GeneratedImage {
  editedBlob?: Blob;
  isEdited?: boolean;
}

interface EditedImageOverride {
  originalBlob: Blob;
  editedBlob: Blob;
  previewUrl: string;
  width: number;
  height: number;
  mimeType: string;
  document: ImageEditorDocument;
}

interface EditorSession {
  imageId: string;
  index: number;
  source: ImageEditorSource;
}

const resultImages = computed(() => props.record?.images ?? []);
const editedImages = shallowRef(new Map<string, EditedImageOverride>());
const displayImages = computed<DisplayImage[]>(() =>
  resultImages.value.map((image) => {
    const edited = editedImages.value.get(image.id);
    if (!edited) return image;
    return {
      ...image,
      remoteUrl: edited.previewUrl,
      width: edited.width,
      height: edited.height,
      mimeType: edited.mimeType,
      editedBlob: edited.editedBlob,
      isEdited: true
    };
  })
);
const isSingleResult = computed(() => displayImages.value.length === 1);
const primaryImage = computed(() => displayImages.value[0] ?? null);
const hasSaveDirectory = computed(() => Boolean(props.saveDirectory.trim()));
const recoverableTaskLabel = computed(() => {
  if (!props.recoverableTask) return "";
  const modeLabel = props.recoverableTask.mode === "image-to-image" ? "图生图" : "文生图";
  const statusLabel = props.recoverableTask.status === "queued" ? "排队中" : "生成中";
  return `${modeLabel} · ${statusLabel}`;
});
const saving = shallowRef(false);
const copying = shallowRef(false);
const loadingEditor = shallowRef(false);
const actionError = shallowRef("");
const actionMessage = shallowRef("");
const contextMenuTarget = shallowRef<{ image: DisplayImage; index: number } | null>(null);
const contextMenuX = shallowRef(0);
const contextMenuY = shallowRef(0);
const editorSession = shallowRef<EditorSession | null>(null);
const editButton = useTemplateRef<HTMLButtonElement>("editButton");
let actionMessageTimer: number | undefined;

watch(
  () => props.record?.generationId,
  () => {
    closeContextMenu();
    editorSession.value = null;
    clearEditedImages();
  }
);

function imageFrameStyle(image: GeneratedImage) {
  return isSingleResult.value ? undefined : { aspectRatio: `${image.width} / ${image.height}` };
}

function suggestedImageName(index: number, edited = false) {
  if (!props.record) return "huanhua-image";
  const baseName = resultImages.value.length > 1
    ? `huanhua-${props.record.generationId}-${index + 1}`
    : `huanhua-${props.record.generationId}`;
  return edited ? `${baseName}-edited` : baseName;
}

function showActionMessage(message: string) {
  actionMessage.value = message;
  if (actionMessageTimer) window.clearTimeout(actionMessageTimer);
  actionMessageTimer = window.setTimeout(() => {
    actionMessage.value = "";
    actionMessageTimer = undefined;
  }, 2400);
}

async function downloadImage(image: DisplayImage, index: number) {
  if (!props.record) return;
  saving.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    if (image.editedBlob) {
      await saveImageBlobAs(
        image.editedBlob,
        suggestedImageName(index, true),
        image.mimeType
      );
    } else {
      await saveRemoteImageAs(
        image.remoteUrl,
        suggestedImageName(index),
        image.mimeType
      );
    }
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片保存失败，请稍后重试。";
  } finally {
    saving.value = false;
  }
}

async function downloadPrimaryImage() {
  if (!primaryImage.value) return;
  await downloadImage(primaryImage.value, 0);
}

async function copyImage(image: DisplayImage) {
  copying.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    if (image.editedBlob) await copyImageBlobToClipboard(image.editedBlob);
    else await copyRemoteImageToClipboard(image.remoteUrl, image.mimeType);
    showActionMessage("图片已复制");
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片复制失败，请稍后重试。";
  } finally {
    copying.value = false;
  }
}

async function copyPrimaryImage() {
  if (!primaryImage.value) return;
  await copyImage(primaryImage.value);
}

function openImageContextMenu(event: MouseEvent, image: DisplayImage, index: number) {
  if (props.record?.mode !== "text-to-image") return;
  event.preventDefault();
  event.stopPropagation();

  const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const requestedX = event.clientX || targetRect.left + Math.min(36, targetRect.width / 2);
  const requestedY = event.clientY || targetRect.top + Math.min(36, targetRect.height / 2);
  showImageContextMenu(image, index, requestedX, requestedY);
}

function openImageContextMenuFromKeyboard(event: KeyboardEvent, image: DisplayImage, index: number) {
  const isMenuShortcut = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
  if (!isMenuShortcut || props.record?.mode !== "text-to-image") return;
  event.preventDefault();
  event.stopPropagation();

  const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  showImageContextMenu(
    image,
    index,
    targetRect.left + Math.min(36, targetRect.width / 2),
    targetRect.top + Math.min(36, targetRect.height / 2)
  );
}

function showImageContextMenu(image: DisplayImage, index: number, requestedX: number, requestedY: number) {
  contextMenuX.value = Math.max(8, Math.min(requestedX, window.innerWidth - 176));
  contextMenuY.value = Math.max(8, Math.min(requestedY, window.innerHeight - 124));
  contextMenuTarget.value = { image, index };
}

function closeContextMenu() {
  contextMenuTarget.value = null;
}

async function copyContextImage() {
  const target = contextMenuTarget.value;
  closeContextMenu();
  if (!target) return;
  await copyImage(target.image);
}

async function downloadContextImage() {
  const target = contextMenuTarget.value;
  closeContextMenu();
  if (!target) return;
  await downloadImage(target.image, target.index);
}

async function useContextImageAsReference() {
  const target = contextMenuTarget.value;
  closeContextMenu();
  if (!target || !props.record) return;
  actionError.value = "";
  actionMessage.value = "";
  try {
    const selected = target.image.editedBlob
      ? imageBlobToSelectedFile(
          target.image.editedBlob,
          suggestedImageName(target.index, true),
          target.image.mimeType
        )
      : await remoteImageToSelectedFile(
          target.image.remoteUrl,
          suggestedImageName(target.index),
          target.image.mimeType
        );
    emit("useAsReference", selected);
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请稍后重试。";
  }
}

async function openEditor() {
  const originalImage = resultImages.value[0];
  if (!originalImage || !props.record) return;
  loadingEditor.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    const existing = editedImages.value.get(originalImage.id);
    const originalBlob = existing?.originalBlob
      ?? await loadRemoteImageBlob(originalImage.remoteUrl, originalImage.mimeType);
    const mimeType = originalImage.mimeType || originalBlob.type || "image/png";
    editorSession.value = {
      imageId: originalImage.id,
      index: 0,
      source: {
        blob: originalBlob,
        mimeType,
        fileBaseName: suggestedImageName(0),
        quality: props.record.params.outputFormat === "png"
          ? undefined
          : props.record.params.outputCompression / 100,
        document: existing?.document
      }
    };
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请稍后重试。";
  } finally {
    loadingEditor.value = false;
  }
}

function removeEditedImage(imageId: string) {
  const existing = editedImages.value.get(imageId);
  if (!existing) return;
  URL.revokeObjectURL(existing.previewUrl);
  const next = new Map(editedImages.value);
  next.delete(imageId);
  editedImages.value = next;
}

function applyEditorResult(result: ImageEditorApplyResult) {
  const session = editorSession.value;
  if (!session) return;
  if (result.pristine) {
    removeEditedImage(session.imageId);
    closeEditor();
    showActionMessage("已恢复原图");
    return;
  }

  const previous = editedImages.value.get(session.imageId);
  if (previous) URL.revokeObjectURL(previous.previewUrl);
  const next = new Map(editedImages.value);
  next.set(session.imageId, {
    originalBlob: session.source.blob,
    editedBlob: result.blob,
    previewUrl: URL.createObjectURL(result.blob),
    width: result.width,
    height: result.height,
    mimeType: result.mimeType,
    document: result.document
  });
  editedImages.value = next;
  closeEditor();
  showActionMessage("已应用编辑");
}

function closeEditor() {
  editorSession.value = null;
  nextTick(() => editButton.value?.focus());
}

function clearEditedImages() {
  editedImages.value.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  editedImages.value = new Map();
}

async function openSaveDirectory() {
  actionError.value = "";
  try {
    await openDirectory(props.saveDirectory.trim());
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "无法打开保存位置。";
  }
}

onBeforeUnmount(() => {
  if (actionMessageTimer) window.clearTimeout(actionMessageTimer);
  clearEditedImages();
});
</script>

<template>
  <section class="result-panel">
    <div class="result-stage">
      <button
        v-if="recoverableTask"
        class="task-recovery-button"
        type="button"
        :aria-label="`恢复${recoverableTaskLabel}任务`"
        title="恢复正在进行的任务"
        @click="emit('restoreTask')"
      >
        <LoaderCircle class="task-recovery-spinner" :size="15" aria-hidden="true" />
        <span>
          <small>正在进行的任务</small>
          <strong>{{ recoverableTaskLabel }}</strong>
        </span>
        <RotateCcw :size="14" aria-hidden="true" />
      </button>
      <div v-if="loading" class="result-loading" role="status" aria-live="polite">
        <div class="image-skeleton">
          <span class="frame-corner corner-tl" />
          <span class="frame-corner corner-tr" />
          <span class="frame-corner corner-bl" />
          <span class="frame-corner corner-br" />
          <div class="skeleton-mark">
            <div class="skeleton-stage" aria-hidden="true">
              <span class="skeleton-orbit" />
              <span class="skeleton-orbit orbit-b" />
              <img class="skeleton-logo" :src="brandMark" alt="" />
            </div>
            <div class="skeleton-caption">
              正在创作...
              <button v-if="canCancel" class="cancel-task-button" type="button" @click="emit('cancel')">
                <Ban :size="14" /> 取消任务
              </button>
            </div>
          </div>
        </div>
      </div>
      <div v-else-if="displayImages.length" class="image-grid" :class="{ 'single-result': isSingleResult }">
        <figure
          v-for="(image, index) in displayImages"
          :key="image.id"
          class="result-image"
          :style="imageFrameStyle(image)"
          :tabindex="record?.mode === 'text-to-image' ? 0 : undefined"
          :aria-label="record?.mode === 'text-to-image' ? `生成图片 ${index + 1}，可打开图片菜单` : undefined"
          @contextmenu="openImageContextMenu($event, image, index)"
          @keydown="openImageContextMenuFromKeyboard($event, image, index)"
        >
          <img
            :src="image.remoteUrl"
            :alt="`${image.isEdited ? '编辑后的' : ''}生成图片 ${index + 1}`"
          />
        </figure>
      </div>
      <GenerationEmptyState v-else :mode="mode" />

      <p v-if="actionError" class="result-action-feedback is-error" role="alert">{{ actionError }}</p>
      <p v-else-if="actionMessage" class="result-action-feedback" role="status">{{ actionMessage }}</p>
      <div v-if="displayImages.length && !loading" class="toolbar result-toolbar" role="toolbar" aria-label="图片操作">
        <button
          class="icon-button result-tool"
          type="button"
          title="复制图片"
          aria-label="复制图片"
          :disabled="copying"
          @click="copyPrimaryImage"
        >
          <LoaderCircle v-if="copying" class="saving-spinner" :size="16" />
          <Clipboard v-else :size="16" />
        </button>
        <button
          ref="editButton"
          class="icon-button result-tool"
          type="button"
          :title="primaryImage?.isEdited ? '继续编辑图片' : '编辑图片'"
          :aria-label="primaryImage?.isEdited ? '继续编辑图片' : '编辑图片'"
          :disabled="loadingEditor"
          @click="openEditor"
        >
          <LoaderCircle v-if="loadingEditor" class="saving-spinner" :size="16" />
          <Pencil v-else :size="16" />
        </button>
        <button
          class="icon-button result-tool"
          type="button"
          title="下载图片"
          aria-label="下载图片"
          :disabled="saving"
          @click="downloadPrimaryImage"
        >
          <LoaderCircle v-if="saving" class="saving-spinner" :size="16" />
          <Download v-else :size="16" />
        </button>
        <button
          v-if="hasSaveDirectory"
          class="icon-button result-tool"
          type="button"
          title="打开默认保存位置"
          aria-label="打开默认保存位置"
          @click="openSaveDirectory"
        >
          <FolderOpen :size="16" />
        </button>
      </div>
      <ResultImageContextMenu
        v-if="contextMenuTarget"
        :x="contextMenuX"
        :y="contextMenuY"
        @close="closeContextMenu"
        @copy="copyContextImage"
        @download="downloadContextImage"
        @use-as-reference="useContextImageAsReference"
      />
      <ImageEditorModal
        v-if="editorSession"
        :source="editorSession.source"
        @apply="applyEditorResult"
        @close="closeEditor"
      />
    </div>
  </section>
</template>

<style scoped lang="scss">
.result-panel {
  position: relative;
  min-height: 0;
  display: block;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: var(--bg);
  box-shadow: none;
}

.result-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 14px;

  > .generation-empty {
    width: 100%;
    height: 100%;
    min-height: 0;
    border: 0;
    background: transparent;
  }
}

.result-tool {
  color: var(--muted);
}

.task-recovery-button {
  position: absolute;
  z-index: 6;
  top: 24px;
  right: 24px;
  min-width: 168px;
  min-height: 42px;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  color: var(--soft);
  background: rgba(21, 29, 39, 0.94);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
  text-align: left;
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;

  &:hover,
  &:focus-visible {
    border-color: var(--accent-border);
    color: var(--text);
    background: var(--surface-strong);
  }

  > span {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  small,
  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--muted);
    font-size: 9px;
    font-weight: 600;
  }

  strong {
    font-size: 11px;
    font-weight: 680;
  }

  > svg:last-child {
    color: var(--accent-strong);
  }
}

.task-recovery-spinner {
  color: var(--accent);
  will-change: transform;
  animation: spin 0.9s linear infinite;
}

.result-toolbar {
  position: absolute;
  z-index: 4;
  top: 24px;
  right: 24px;

  :deep(.icon-button) {
    border-color: rgba(223, 230, 239, 0.16);
    color: var(--text);
    background: rgba(16, 22, 29, 0.84);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }
}

.result-action-feedback {
  position: absolute;
  z-index: 5;
  top: 70px;
  right: 24px;
  max-width: min(380px, calc(100% - 48px));
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(101, 211, 173, 0.38);
  border-radius: 6px;
  color: var(--success);
  background: rgba(16, 22, 29, 0.94);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.45;

  &.is-error {
    border-color: rgba(239, 125, 136, 0.42);
    color: var(--danger);
  }
}

.saving-spinner {
  will-change: transform;
  animation: spin 0.9s linear infinite;
}

.image-grid {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 12px;
  overflow: auto;
  scrollbar-color: var(--line-strong) transparent;

  &.single-result {
    grid-template-columns: minmax(0, 1fr);
    place-items: center;
    overflow: hidden;
  }
}

.result-image {
  position: relative;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--field);
  box-shadow: none;

  &:focus-visible {
    border-color: var(--accent);
    outline: 2px solid var(--accent-border);
    outline-offset: -3px;
  }

  img {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: block;
    object-fit: contain;
  }
}

.single-result .result-image {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.image-skeleton {
  position: relative;
  min-height: 0;
  overflow: hidden;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  background:
    radial-gradient(120% 90% at 50% 0%, var(--surface-subtle), transparent 62%),
    var(--field);
}

.frame-corner {
  position: absolute;
  width: 44px;
  height: 44px;
  border-style: solid;
  border-color: var(--line-strong);
  opacity: 0.9;
  will-change: opacity;
  animation: corner-pulse 2.4s ease-in-out infinite;
}

.corner-tl {
  top: 6%;
  left: 6%;
  border-width: 1.5px 0 0 1.5px;
  border-radius: 7px 0 0;
}

.corner-tr {
  top: 6%;
  right: 6%;
  border-width: 1.5px 1.5px 0 0;
  border-color: var(--accent-border);
  border-radius: 0 7px 0 0;
  animation-delay: 0.2s;
}

.corner-bl {
  bottom: 6%;
  left: 6%;
  border-width: 0 0 1.5px 1.5px;
  border-color: var(--accent-border);
  border-radius: 0 0 0 7px;
  animation-delay: 0.2s;
}

.corner-br {
  right: 6%;
  bottom: 6%;
  border-width: 0 1.5px 1.5px 0;
  border-radius: 0 0 7px;
}

.skeleton-mark {
  position: relative;
  width: min(46%, 340px);
  aspect-ratio: 1;
  display: grid;
  place-items: center;
}

.skeleton-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  display: grid;
  place-items: center;
}

.skeleton-logo {
  width: 50%;
  height: 50%;
  display: block;
  opacity: 0.92;
  will-change: opacity, transform;
  animation: mark-breathe 2.4s ease-in-out infinite;
}

.skeleton-orbit {
  position: absolute;
  inset: 0;
  border: 1.5px solid transparent;
  border-top-color: var(--accent);
  border-right-color: var(--accent);
  border-radius: 50%;
  opacity: 0.75;
  will-change: transform;
  animation: spin 1.3s linear infinite;
}

.orbit-b {
  inset: -13px;
  border-color: transparent;
  border-bottom-color: var(--tech-cyan);
  border-left-color: var(--tech-cyan);
  opacity: 0.45;
  animation-duration: 2.1s;
  animation-direction: reverse;
}

.result-loading {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  place-items: center;

  .image-skeleton {
    width: 66.7%;
    max-width: 100%;
    aspect-ratio: 1;
    height: auto;
    max-height: 100%;
  }
}

.skeleton-caption {
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 26px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  color: var(--soft);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0;
}

.cancel-task-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 5px;
  padding-left: 10px;
  border-left: 1px solid var(--line-strong);
  color: var(--danger);
  font-size: 11px;
  font-weight: 650;
}

@keyframes corner-pulse {
  0%,
  100% {
    opacity: 0.4;
  }

  50% {
    opacity: 0.95;
  }
}

@keyframes mark-breathe {
  0%,
  100% {
    opacity: 0.45;
    transform: scale(0.95);
  }

  50% {
    opacity: 0.95;
    transform: scale(1);
  }
}

@media (max-width: 900px) {
  .result-panel {
    min-height: 560px;
    border-bottom: 1px solid var(--line);
  }
}

@media (max-width: 600px) {
  .result-stage {
    padding: 14px;
  }

  .image-grid {
    grid-template-columns: 1fr;
    overflow: auto;
  }
}
</style>
