<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { AlertTriangle, CircleAlert, ImageUp, Trash2, X, ZoomIn } from "lucide-vue-next";
import { chooseImageFile } from "@/services/desktop";
import type { SelectedImageFile } from "@/types";

const referenceImage = defineModel<SelectedImageFile | null>("referenceImage", { required: true });
const props = defineProps<{ maxBytes: number }>();

const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const previewUrl = ref<string | null>(null);
const fileName = computed(() => referenceImage.value?.name ?? "");
const maxMb = computed(() => Math.floor(props.maxBytes / 1024 / 1024) || 1);

const dragActive = ref(false);
const error = ref("");
const showEnlarge = ref(false);
const showConfirm = ref(false);

const enlargeDialog = ref<HTMLElement | null>(null);
const confirmDialog = ref<HTMLElement | null>(null);

watch(
  () => referenceImage.value,
  (next) => {
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = next?.file ? URL.createObjectURL(next.file) : null;
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});

function buildSelectedImage(file: File): SelectedImageFile {
  const name = file.name || `reference-${Date.now()}.${file.type.split("/")[1] ?? "png"}`;
  return { name, path: name, file };
}

function acceptFile(file: File) {
  error.value = "";
  if (!SUPPORTED_TYPES.includes(file.type)) {
    error.value = "仅支持 JPEG、PNG 和 WebP 图片。";
    return;
  }
  if (file.size > props.maxBytes) {
    error.value = `参考图片不能超过 ${maxMb.value} MB。`;
    return;
  }
  referenceImage.value = buildSelectedImage(file);
}

async function pickFile() {
  const selected = await chooseImageFile();
  if (!selected) return;
  acceptFile(selected.file);
}

function onDrop(event: DragEvent) {
  dragActive.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) acceptFile(file);
}

function openEnlarge() {
  if (!previewUrl.value) return;
  showEnlarge.value = true;
  nextTick(() => enlargeDialog.value?.focus());
}

function closeEnlarge() {
  showEnlarge.value = false;
}

function askDelete() {
  showConfirm.value = true;
  nextTick(() => confirmDialog.value?.focus());
}

function cancelDelete() {
  showConfirm.value = false;
}

function confirmDelete() {
  referenceImage.value = null;
  showConfirm.value = false;
  dragActive.value = false;
  error.value = "";
}
</script>

<template>
  <div class="reference-uploader">
    <button
      v-if="!previewUrl"
      type="button"
      class="upload-zone"
      :class="{ 'is-drag': dragActive }"
      @click="pickFile"
      @dragenter.prevent="dragActive = true"
      @dragover.prevent="dragActive = true"
      @dragleave.prevent="dragActive = false"
      @drop.prevent="onDrop"
    >
      <ImageUp :size="24" />
      <strong>上传参考图</strong>
      <span>点击选择文件，或将图片拖拽到此处</span>
      <small>支持 PNG / JPG / WEBP，最大 {{ maxMb }} MB</small>
    </button>

    <div v-else class="reference-preview">
      <button class="reference-preview-button" type="button" aria-label="放大查看参考图" @click="openEnlarge">
        <img :src="previewUrl ?? undefined" :alt="`参考图：${fileName}`" />
        <span class="reference-preview-hint"><ZoomIn :size="14" /> 点击放大</span>
      </button>
      <button class="reference-delete" type="button" aria-label="删除参考图" @click.stop="askDelete">
        <Trash2 :size="15" />
      </button>
      <span class="reference-file-name">{{ fileName }}</span>
    </div>

    <p v-if="error" class="reference-error" role="alert">
      <CircleAlert :size="14" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>

    <Transition name="modal" appear>
      <div v-if="showEnlarge" class="reference-overlay" @click.self="closeEnlarge">
        <div
          ref="enlargeDialog"
          class="reference-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reference-preview-title"
          tabindex="-1"
          @keydown.esc="closeEnlarge"
        >
          <header class="reference-dialog-header">
            <div>
              <h2 id="reference-preview-title">参考图预览</h2>
              <p>{{ fileName }}</p>
            </div>
            <button class="icon-button" type="button" aria-label="关闭预览" @click="closeEnlarge">
              <X :size="18" />
            </button>
          </header>
          <div class="reference-dialog-canvas">
            <img :src="previewUrl ?? undefined" :alt="`参考图原图：${fileName}`" />
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="modal" appear>
      <div v-if="showConfirm" class="modal-backdrop" @click.self="cancelDelete">
        <div
          ref="confirmDialog"
          class="modal reference-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reference-delete-title"
          tabindex="-1"
          @keydown.esc="cancelDelete"
        >
          <button class="icon-button modal-close" type="button" aria-label="取消删除" @click="cancelDelete">
            <X :size="18" />
          </button>
          <div class="reference-confirm-icon"><AlertTriangle :size="22" aria-hidden="true" /></div>
          <h2 id="reference-delete-title">删除参考图</h2>
          <p>删除后将清除当前参考图，你需要重新上传才能继续图生图。</p>
          <div class="reference-confirm-actions">
            <button class="ghost-button" type="button" @click="cancelDelete">取消</button>
            <button class="confirm-delete-button" type="button" @click="confirmDelete">
              <Trash2 :size="16" aria-hidden="true" /> 删除
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.reference-uploader {
  margin-bottom: 15px;
}

.upload-zone {
  width: 100%;
  min-height: 168px;
  display: grid;
  place-items: center;
  gap: 6px;
  padding: 18px;
  border: 1px dashed rgba(101, 207, 224, 0.42);
  border-radius: 7px;
  color: var(--tech-cyan);
  background: rgba(101, 207, 224, 0.07);
  cursor: pointer;
  text-align: center;
  transition:
    border-color 180ms ease,
    background 180ms ease;

  &:hover,
  &.is-drag {
    border-color: rgba(101, 207, 224, 0.7);
    background: rgba(101, 207, 224, 0.1);
  }

  strong {
    font-size: 13px;
    font-weight: 650;
  }

  span {
    max-width: 92%;
    overflow: hidden;
    color: var(--muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--muted);
    font-size: 10px;
    font-weight: 500;
  }
}

.reference-preview {
  position: relative;
  display: grid;
  gap: 6px;
}

.reference-preview-button {
  position: relative;
  display: block;
  width: 100%;
  height: 168px;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--field);
  cursor: zoom-in;
  overflow: hidden;
  transition: border-color 180ms ease;

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  &:hover {
    border-color: var(--line-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.reference-preview-hint {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  color: var(--soft);
  background: rgba(13, 19, 26, 0.82);
  font-size: 10px;
  font-weight: 600;
  opacity: 0;
  transition: opacity 160ms ease;
}

.reference-preview-button:hover .reference-preview-hint,
.reference-preview-button:focus-visible .reference-preview-hint {
  opacity: 1;
}

.reference-delete {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  color: var(--danger);
  background: rgba(13, 19, 26, 0.82);
  cursor: pointer;
  transition:
    color 160ms ease,
    background 160ms ease,
    border-color 160ms ease;

  &:hover {
    color: #ff9ba4;
    border-color: rgba(239, 125, 136, 0.6);
    background: rgba(239, 125, 136, 0.16);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.reference-file-name {
  overflow: hidden;
  color: var(--muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-error {
  display: grid;
  grid-template-columns: 14px minmax(0, 1fr);
  align-items: start;
  gap: 6px;
  margin: 8px 0 0;
  padding: 8px 10px;
  border: 1px solid rgba(239, 125, 136, 0.42);
  border-radius: 7px;
  color: var(--danger);
  background: rgba(239, 125, 136, 0.08);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;

  svg {
    margin-top: 1px;
  }
}

.reference-overlay {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 28px;
  background: rgba(4, 7, 11, 0.82);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

.reference-dialog {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;

  &:focus {
    outline: none;
  }
}

.reference-dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;

  h2 {
    margin: 0;
    color: var(--text);
    font-size: 16px;
    font-weight: 660;
  }

  p {
    margin: 4px 0 0;
    overflow: hidden;
    color: var(--muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.reference-dialog-canvas {
  min-height: 0;
  display: grid;
  place-items: center;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 6px;
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.5);
  }
}

.modal.reference-confirm {
  width: min(420px, 100%);
  text-align: center;

  h2 {
    margin: 0;
  }

  p {
    margin: 8px 0 18px;
  }
}

.reference-confirm-icon {
  width: 46px;
  height: 46px;
  margin: 0 auto 14px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(239, 125, 136, 0.5);
  border-radius: 50%;
  color: var(--danger);
  background: rgba(239, 125, 136, 0.1);
}

.reference-confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: center;

  .ghost-button,
  .confirm-delete-button {
    min-height: 38px;
    padding: 0 18px;
  }
}

.confirm-delete-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(239, 125, 136, 0.5);
  border-radius: 7px;
  color: #fff;
  background: var(--danger);
  font-weight: 650;
  cursor: pointer;
  transition:
    background 160ms ease,
    border-color 160ms ease;

  &:hover {
    background: #f06673;
    border-color: rgba(239, 125, 136, 0.8);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}
</style>
