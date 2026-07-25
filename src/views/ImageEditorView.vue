<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from "vue";
import ImageEditorEmptyWorkspace from "@/components/image-editor/ImageEditorEmptyWorkspace.vue";
import ImageEditorWorkspace from "@/components/image-editor/ImageEditorWorkspace.vue";
import type {
  ImageEditorApplyResult,
  ImageEditorDocument,
  ImageEditorSource
} from "@/components/image-editor/types";
import { preloadImageEditorRuntime } from "@/components/image-editor/useImageEditor";
import {
  chooseImageFile,
  copyImageBlobToClipboard,
  saveImageBlobAs,
  selectedImageFileFromFile
} from "@/services/desktop";
import {
  consumeImageEditorHandoff,
  type ImageEditorHandoff
} from "@/services/imageEditorHandoff";
import type { SelectedImageFile } from "@/types";

const selectedFile = shallowRef<SelectedImageFile | null>(null);
const editedBlob = shallowRef<Blob | null>(null);
const editorDocument = shallowRef<ImageEditorDocument | undefined>();
const editorSource = shallowRef<ImageEditorSource | null>(null);
const editorQuality = shallowRef<number | undefined>();
const editorSessionKey = shallowRef(0);
const selecting = shallowRef(false);
const copying = shallowRef(false);
const saving = shallowRef(false);
const actionError = shallowRef("");
const actionMessage = shallowRef("");
let actionMessageTimer: number | undefined;

const mimeType = computed(() => normalizeMimeType(selectedFile.value));
const fileBaseName = computed(() => baseNameWithoutExtension(selectedFile.value?.name || "huanhua-image"));
const currentBlob = computed(() => editedBlob.value ?? selectedFile.value?.file ?? null);
const isEdited = computed(() => Boolean(editedBlob.value && editorDocument.value));

function baseNameWithoutExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
}

function normalizeMimeType(selected: SelectedImageFile | null) {
  const type = selected?.file.type;
  if (type === "image/jpeg" || type === "image/png" || type === "image/webp") return type;
  const extension = selected?.name.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return "image/png";
}

function showMessage(message: string) {
  actionMessage.value = message;
  if (actionMessageTimer) window.clearTimeout(actionMessageTimer);
  actionMessageTimer = window.setTimeout(() => {
    actionMessage.value = "";
    actionMessageTimer = undefined;
  }, 2400);
}

function clearWorkspace() {
  editorSource.value = null;
  selectedFile.value = null;
  editedBlob.value = null;
  editorDocument.value = undefined;
  editorQuality.value = undefined;
}

function createEditorSource(): ImageEditorSource | null {
  const selected = selectedFile.value;
  if (!selected) return null;
  return {
    blob: selected.file,
    mimeType: mimeType.value,
    fileBaseName: fileBaseName.value,
    quality: editorQuality.value ?? (mimeType.value === "image/png" ? undefined : 0.92),
    document: editorDocument.value
  };
}

function loadSelectedImage(
  selected: SelectedImageFile,
  options: Omit<ImageEditorHandoff, "selectedFile"> = {}
) {
  clearWorkspace();
  selectedFile.value = selected;
  editedBlob.value = options.applied?.blob ?? null;
  editorDocument.value = options.document;
  editorQuality.value = options.quality;
  editorSessionKey.value += 1;
  void preloadImageEditorRuntime().catch(() => undefined);
  editorSource.value = createEditorSource();
}

async function chooseImage() {
  if (selecting.value) return;
  selecting.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    const selected = await chooseImageFile();
    if (selected) loadSelectedImage(selected);
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请重新选择。";
  } finally {
    selecting.value = false;
  }
}

function loadDroppedImage(file: File) {
  actionError.value = "";
  actionMessage.value = "";
  try {
    loadSelectedImage(selectedImageFileFromFile(file));
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请重新选择。";
  }
}

function applyEditorResult(result: ImageEditorApplyResult) {
  if (!selectedFile.value) return;

  if (result.pristine) {
    editedBlob.value = null;
    editorDocument.value = undefined;
    showMessage("已恢复原图");
    return;
  }

  editedBlob.value = result.blob;
  editorDocument.value = result.document;
  showMessage("已应用编辑");
}

async function copyImage() {
  if (!currentBlob.value || copying.value) return;
  copying.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    await copyImageBlobToClipboard(currentBlob.value);
    showMessage("图片已复制");
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片复制失败，请稍后重试。";
  } finally {
    copying.value = false;
  }
}

async function saveImage() {
  if (!currentBlob.value || saving.value) return;
  saving.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    const savedPath = await saveImageBlobAs(
      currentBlob.value,
      `${fileBaseName.value}-edited`,
      mimeType.value
    );
    if (savedPath) showMessage("图片已保存");
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片保存失败，请稍后重试。";
  } finally {
    saving.value = false;
  }
}

const handoff = consumeImageEditorHandoff();
if (handoff) {
  loadSelectedImage(handoff.selectedFile, {
    document: handoff.document,
    applied: handoff.applied,
    quality: handoff.quality
  });
}

onBeforeUnmount(() => {
  if (actionMessageTimer) window.clearTimeout(actionMessageTimer);
});
</script>

<template>
  <section class="page-view image-editor-view">
    <div class="local-editor-workspace">
      <ImageEditorWorkspace
        v-if="editorSource"
        :key="editorSessionKey"
        class="embedded-image-editor"
        :copying="copying"
        :image-actions-enabled="isEdited"
        :saving="saving"
        :source="editorSource"
        presentation="page"
        @apply="applyEditorResult"
        @copy-image="copyImage"
        @save-image="saveImage"
      />
      <ImageEditorEmptyWorkspace
        v-else
        class="embedded-image-editor"
        :selecting="selecting"
        @choose="chooseImage"
        @drop-file="loadDroppedImage"
      />
    </div>

    <p v-if="actionError" class="editor-page-feedback is-error" role="alert">{{ actionError }}</p>
    <p v-else-if="actionMessage" class="editor-page-feedback" role="status">{{ actionMessage }}</p>
  </section>
</template>

<style scoped lang="scss">
.image-editor-view {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.local-editor-workspace {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.embedded-image-editor {
  min-width: 0;
  min-height: 0;
}

.editor-page-feedback {
  position: absolute;
  right: 28px;
  bottom: 74px;
  z-index: 4;
  max-width: min(420px, calc(100% - 56px));
  margin: 0;
  padding: 8px 11px;
  border: 1px solid rgba(101, 211, 173, 0.34);
  border-radius: 6px;
  color: var(--success);
  background: var(--surface-raised);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
  font-size: 11px;
  font-weight: 600;

  &.is-error {
    border-color: rgba(239, 125, 136, 0.44);
    color: var(--danger);
  }
}

@media (max-width: 900px) {
  .image-editor-view {
    min-height: 860px;
    overflow: auto;
    padding: 0;
  }

  .local-editor-workspace {
    min-height: 760px;
  }

  .editor-page-feedback {
    right: 16px;
    bottom: 16px;
    max-width: calc(100% - 32px);
  }
}
</style>
