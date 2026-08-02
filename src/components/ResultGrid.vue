<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import {
  Ban,
  Clipboard,
  Download,
  FolderOpen,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Scissors
} from "lucide-vue-next";
import GenerationEmptyState from "@/components/GenerationEmptyState.vue";
import ResultImageContextMenu from "@/components/ResultImageContextMenu.vue";
import brandMark from "@/assets/huanhua-mark.svg";
import {
  copyRemoteImageToClipboard,
  imageBlobToSelectedFile,
  loadRemoteImageBlob,
  openDirectory,
  remoteImageToSelectedFile,
  saveRemoteImageAs
} from "@/services/desktop";
import type { ImageEditorHandoff } from "@/services/imageEditorHandoff";
import type { CutoutHandoff } from "@/services/cutoutHandoff";
import { preloadImageEditorRuntime } from "@/components/image-editor/useImageEditor";
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
  editImage: [handoff: ImageEditorHandoff];
  cutoutImage: [handoff: CutoutHandoff];
  restoreTask: [];
  useAsReference: [image: SelectedImageFile];
}>();

interface IdleCallbacks {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

const resultImages = computed(() => props.record?.images ?? []);
const displayImages = computed(() => resultImages.value);
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
const loadingCutout = shallowRef(false);
const actionError = shallowRef("");
const actionMessage = shallowRef("");
const contextMenuTarget = shallowRef<{ image: GeneratedImage; index: number } | null>(null);
const contextMenuX = shallowRef(0);
const contextMenuY = shallowRef(0);
const originalBlobPromises = new Map<string, Promise<Blob>>();
let actionMessageTimer: number | undefined;
let editorPreloadTimer: number | undefined;
let editorPreloadIdleHandle: number | undefined;

watch(
  () => props.record?.generationId,
  () => {
    closeContextMenu();
    clearEditorPreloadCache();
  },
  { flush: "post" }
);

watch(
  [
    () => props.loading,
    () => resultImages.value[0]?.id,
    () => resultImages.value[0]?.remoteUrl
  ],
  ([loading, imageId, remoteUrl]) => {
    if (loading || !imageId || !remoteUrl) {
      cancelEditorPreloadSchedule();
      return;
    }
    scheduleEditorPreload();
  },
  { flush: "post", immediate: true }
);

function imageFrameStyle(image: GeneratedImage) {
  return isSingleResult.value ? undefined : { aspectRatio: `${image.width} / ${image.height}` };
}

function suggestedImageName(index: number) {
  if (!props.record) return "huanhua-image";
  return resultImages.value.length > 1
    ? `huanhua-${props.record.generationId}-${index + 1}`
    : `huanhua-${props.record.generationId}`;
}

function showActionMessage(message: string) {
  actionMessage.value = message;
  if (actionMessageTimer) window.clearTimeout(actionMessageTimer);
  actionMessageTimer = window.setTimeout(() => {
    actionMessage.value = "";
    actionMessageTimer = undefined;
  }, 2400);
}

function cancelEditorPreloadSchedule() {
  const idleCallbacks = window as unknown as IdleCallbacks;
  if (editorPreloadIdleHandle !== undefined) {
    idleCallbacks.cancelIdleCallback?.(editorPreloadIdleHandle);
    editorPreloadIdleHandle = undefined;
  }
  if (editorPreloadTimer !== undefined) {
    window.clearTimeout(editorPreloadTimer);
    editorPreloadTimer = undefined;
  }
}

function getOriginalImageBlob(image: GeneratedImage): Promise<Blob> {
  const cached = originalBlobPromises.get(image.id);
  if (cached) return cached;

  const request = loadRemoteImageBlob(image.remoteUrl, image.mimeType);
  originalBlobPromises.set(image.id, request);
  void request.catch(() => {
    if (originalBlobPromises.get(image.id) === request) {
      originalBlobPromises.delete(image.id);
    }
  });
  return request;
}

function preloadEditorAssets() {
  cancelEditorPreloadSchedule();
  const image = resultImages.value[0];
  if (!image || props.loading) return;
  void preloadImageEditorRuntime().catch(() => undefined);
  void getOriginalImageBlob(image).catch(() => undefined);
}

function scheduleEditorPreload() {
  cancelEditorPreloadSchedule();
  const idleCallbacks = window as unknown as IdleCallbacks;
  if (idleCallbacks.requestIdleCallback) {
    editorPreloadIdleHandle = idleCallbacks.requestIdleCallback(() => {
      editorPreloadIdleHandle = undefined;
      preloadEditorAssets();
    }, { timeout: 900 });
    return;
  }
  editorPreloadTimer = window.setTimeout(() => {
    editorPreloadTimer = undefined;
    preloadEditorAssets();
  }, 120);
}

function clearEditorPreloadCache() {
  cancelEditorPreloadSchedule();
  originalBlobPromises.clear();
}

async function downloadImage(image: GeneratedImage, index: number) {
  if (!props.record) return;
  saving.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    await saveRemoteImageAs(
      image.remoteUrl,
      suggestedImageName(index),
      image.mimeType
    );
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

async function copyImage(image: GeneratedImage) {
  copying.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    await copyRemoteImageToClipboard(image.remoteUrl, image.mimeType);
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

function openImageContextMenu(event: MouseEvent, image: GeneratedImage, index: number) {
  event.preventDefault();
  event.stopPropagation();

  const targetRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const requestedX = event.clientX || targetRect.left + Math.min(36, targetRect.width / 2);
  const requestedY = event.clientY || targetRect.top + Math.min(36, targetRect.height / 2);
  showImageContextMenu(image, index, requestedX, requestedY);
}

function openImageContextMenuFromKeyboard(event: KeyboardEvent, image: GeneratedImage, index: number) {
  const isMenuShortcut = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
  if (!isMenuShortcut) return;
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

function showImageContextMenu(image: GeneratedImage, index: number, requestedX: number, requestedY: number) {
  contextMenuX.value = Math.max(8, Math.min(requestedX, window.innerWidth - 176));
  contextMenuY.value = Math.max(8, Math.min(requestedY, window.innerHeight - 160));
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
    const selected = await remoteImageToSelectedFile(
      target.image.remoteUrl,
      suggestedImageName(target.index),
      target.image.mimeType
    );
    emit("useAsReference", selected);
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请稍后重试。";
  }
}

async function cutoutContextImage() {
  const target = contextMenuTarget.value;
  closeContextMenu();
  if (!target) return;
  await openCutout(target.image, target.index);
}

async function openEditor() {
  const originalImage = resultImages.value[0];
  if (!originalImage || !props.record) return;
  loadingEditor.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    void preloadImageEditorRuntime().catch(() => undefined);
    const originalBlob = await getOriginalImageBlob(originalImage);
    const mimeType = originalImage.mimeType || originalBlob.type || "image/png";
    emit("editImage", {
      selectedFile: imageBlobToSelectedFile(
        originalBlob,
        suggestedImageName(0),
        mimeType
      ),
      quality: props.record.params.outputFormat === "png"
        ? undefined
        : props.record.params.outputCompression / 100
    });
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请稍后重试。";
  } finally {
    loadingEditor.value = false;
  }
}

async function openCutout(
  originalImage = resultImages.value[0],
  index = 0
) {
  if (!originalImage || !props.record) return;
  loadingCutout.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    const originalBlob = await getOriginalImageBlob(originalImage);
    const mimeType = originalImage.mimeType || originalBlob.type || "image/png";
    emit("cutoutImage", {
      selectedFile: imageBlobToSelectedFile(
        originalBlob,
        suggestedImageName(index),
        mimeType
      )
    });
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请稍后重试。";
  } finally {
    loadingCutout.value = false;
  }
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
  clearEditorPreloadCache();
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
          tabindex="0"
          :aria-label="`生成图片 ${index + 1}，可打开图片菜单`"
          @contextmenu="openImageContextMenu($event, image, index)"
          @keydown="openImageContextMenuFromKeyboard($event, image, index)"
        >
          <img
            :src="image.remoteUrl"
            :alt="`生成图片 ${index + 1}`"
            @load="index === 0 && scheduleEditorPreload()"
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
          class="icon-button result-tool"
          type="button"
          title="在图片编辑页打开"
          aria-label="在图片编辑页打开"
          :disabled="loadingEditor"
          @focus="preloadEditorAssets"
          @pointerenter="preloadEditorAssets"
          @click="openEditor"
        >
          <LoaderCircle v-if="loadingEditor" class="saving-spinner" :size="16" />
          <Pencil v-else :size="16" />
        </button>
        <button
          class="icon-button result-tool"
          type="button"
          title="AI 抠图"
          aria-label="AI 抠图"
          :disabled="loadingCutout"
          @click="openCutout()"
        >
          <LoaderCircle v-if="loadingCutout" class="saving-spinner" :size="16" />
          <Scissors v-else :size="16" />
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
        @cutout="cutoutContextImage"
        @download="downloadContextImage"
        @use-as-reference="useContextImageAsReference"
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
