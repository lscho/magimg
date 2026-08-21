<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { AlertTriangle, CircleAlert, ImageUp, Plus, Trash2, X, ZoomIn } from "lucide-vue-next";
import { chooseImageFiles, selectedImageFileFromFile } from "@/services/desktop";
import type { SelectedImageFile } from "@/types";

const referenceImages = defineModel<SelectedImageFile[]>("referenceImages", { required: true });
const props = defineProps<{ maxBytes: number; maxImages?: number }>();
const SUPPORTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const maxImageCount = computed(() => props.maxImages ?? 3);
const maxMb = computed(() => Math.floor(props.maxBytes / 1024 / 1024) || 1);
const previewUrls = ref<string[]>([]);
const dragActive = ref(false);
const error = ref("");
const showEnlarge = ref(false);
const deleteIndex = ref<number | null>(null);
const activePreviewIndex = ref(0);
const enlargeDialog = ref<HTMLElement | null>(null);
const confirmDialog = ref<HTMLElement | null>(null);
const activeImage = computed(() => referenceImages.value[activePreviewIndex.value]);
const activePreviewUrl = computed(() => previewUrls.value[activePreviewIndex.value]);

watch(
  () => referenceImages.value,
  (next) => {
    previewUrls.value.forEach(URL.revokeObjectURL);
    previewUrls.value = next.map(image => URL.createObjectURL(image.file));
    if (activePreviewIndex.value >= next.length) activePreviewIndex.value = Math.max(0, next.length - 1);
  },
  { immediate: true }
);

onBeforeUnmount(() => previewUrls.value.forEach(URL.revokeObjectURL));

function imageKey(image: SelectedImageFile) {
  return `${image.path}:${image.file.size}:${image.file.lastModified}`;
}

function appendImages(images: SelectedImageFile[]) {
  error.value = "";
  const remaining = maxImageCount.value - referenceImages.value.length;
  if (remaining <= 0) {
    error.value = `最多上传 ${maxImageCount.value} 张参考图。`;
    return;
  }
  const existingKeys = new Set(referenceImages.value.map(imageKey));
  const accepted: SelectedImageFile[] = [];
  for (const image of images) {
    if (accepted.length >= remaining) break;
    if (!SUPPORTED_TYPES.includes(image.file.type)) {
      error.value ||= "仅支持 JPEG、PNG 和 WebP 图片。";
      continue;
    }
    if (image.file.size > props.maxBytes) {
      error.value ||= `每张参考图不能超过 ${maxMb.value} MB。`;
      continue;
    }
    const key = imageKey(image);
    if (existingKeys.has(key)) {
      error.value ||= "相同的参考图无需重复上传。";
      continue;
    }
    existingKeys.add(key);
    accepted.push(image);
  }
  if (images.length > remaining) error.value = `最多上传 ${maxImageCount.value} 张参考图。`;
  if (accepted.length) referenceImages.value = [...referenceImages.value, ...accepted];
}

async function pickFiles() {
  const remaining = maxImageCount.value - referenceImages.value.length;
  if (remaining > 0) appendImages(await chooseImageFiles(remaining));
}

function onDrop(event: DragEvent) {
  dragActive.value = false;
  const selected: SelectedImageFile[] = [];
  for (const file of Array.from(event.dataTransfer?.files || [])) {
    try {
      selected.push(selectedImageFileFromFile(file));
    } catch {
      error.value = "仅支持 JPEG、PNG 和 WebP 图片。";
    }
  }
  if (selected.length) appendImages(selected);
}

function openEnlarge(index: number) {
  activePreviewIndex.value = index;
  showEnlarge.value = true;
  nextTick(() => enlargeDialog.value?.focus());
}

function closeEnlarge() {
  showEnlarge.value = false;
}

function askDelete(index: number) {
  deleteIndex.value = index;
  nextTick(() => confirmDialog.value?.focus());
}

function cancelDelete() {
  deleteIndex.value = null;
}

function confirmDelete() {
  if (deleteIndex.value !== null) {
    referenceImages.value = referenceImages.value.filter((_, index) => index !== deleteIndex.value);
  }
  deleteIndex.value = null;
  dragActive.value = false;
  error.value = "";
}
</script>

<template>
  <div
    class="reference-uploader"
    :class="{ 'is-drag': dragActive }"
    @dragenter.prevent="dragActive = true"
    @dragover.prevent="dragActive = true"
    @dragleave.prevent="dragActive = false"
    @drop.prevent="onDrop"
  >
    <button v-if="!referenceImages.length" type="button" class="upload-zone" @click="pickFiles">
      <ImageUp :size="24" aria-hidden="true" />
      <strong>上传参考图</strong>
      <span>点击选择文件，或将图片拖拽到此处</span>
      <small>支持 PNG / JPG / WEBP，最多 {{ maxImageCount }} 张，每张最大 {{ maxMb }} MB</small>
    </button>

    <template v-else>
      <div class="reference-heading">
        <span>参考图</span>
        <small>{{ referenceImages.length }} / {{ maxImageCount }}</small>
      </div>
      <div class="reference-grid">
        <article v-for="(image, index) in referenceImages" :key="imageKey(image)" class="reference-item">
          <button class="reference-preview-button" type="button" :aria-label="`放大查看参考图 ${index + 1}`" @click="openEnlarge(index)">
            <img :src="previewUrls[index]" :alt="`参考图 ${index + 1}：${image.name}`" />
            <ZoomIn :size="14" aria-hidden="true" />
          </button>
          <button class="reference-delete" type="button" :aria-label="`删除参考图 ${index + 1}`" @click.stop="askDelete(index)">
            <Trash2 :size="14" aria-hidden="true" />
          </button>
          <span :title="image.name">{{ image.name }}</span>
        </article>
        <button v-if="referenceImages.length < maxImageCount" type="button" class="reference-add" aria-label="继续添加参考图" @click="pickFiles">
          <Plus :size="20" aria-hidden="true" />
          <span>添加</span>
        </button>
      </div>
    </template>

    <p v-if="error" class="reference-error" role="alert">
      <CircleAlert :size="14" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>

    <Transition name="modal" appear>
      <div v-if="showEnlarge && activeImage" class="reference-overlay" @click.self="closeEnlarge">
        <div ref="enlargeDialog" class="reference-dialog" role="dialog" aria-modal="true" aria-labelledby="reference-preview-title" tabindex="-1" @keydown.esc="closeEnlarge">
          <header class="reference-dialog-header">
            <div>
              <h2 id="reference-preview-title">参考图 {{ activePreviewIndex + 1 }}</h2>
              <p>{{ activeImage.name }}</p>
            </div>
            <button class="icon-button" type="button" aria-label="关闭预览" @click="closeEnlarge"><X :size="18" /></button>
          </header>
          <div class="reference-dialog-canvas">
            <img :src="activePreviewUrl" :alt="`参考图原图：${activeImage.name}`" />
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="modal" appear>
      <div v-if="deleteIndex !== null" class="modal-backdrop" @click.self="cancelDelete">
        <div ref="confirmDialog" class="modal reference-confirm" role="dialog" aria-modal="true" aria-labelledby="reference-delete-title" tabindex="-1" @keydown.esc="cancelDelete">
          <button class="icon-button modal-close" type="button" aria-label="取消删除" @click="cancelDelete"><X :size="18" /></button>
          <div class="reference-confirm-icon"><AlertTriangle :size="22" aria-hidden="true" /></div>
          <h2 id="reference-delete-title">删除参考图</h2>
          <p>将从本次图生图任务中移除这张参考图。</p>
          <div class="reference-confirm-actions">
            <button class="ghost-button" type="button" @click="cancelDelete">取消</button>
            <button class="confirm-delete-button" type="button" @click="confirmDelete"><Trash2 :size="16" aria-hidden="true" /> 删除</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.reference-uploader {
  margin-bottom: 15px;
  border-radius: 7px;
  &.is-drag { outline: 2px solid var(--accent); outline-offset: 2px; }
}

.upload-zone {
  width: 100%; min-height: 168px; display: grid; place-items: center; gap: 6px; padding: 18px;
  border: 1px dashed rgba(101, 207, 224, 0.42); border-radius: 7px; color: var(--tech-cyan);
  background: rgba(101, 207, 224, 0.07); cursor: pointer; text-align: center;
  transition: border-color 180ms ease, background 180ms ease;
  &:hover { border-color: rgba(101, 207, 224, 0.7); background: rgba(101, 207, 224, 0.1); }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  strong { font-size: 13px; font-weight: 650; }
  span { color: var(--muted); font-size: 11px; }
  small { color: var(--muted); font-size: 10px; font-weight: 500; }
}

.reference-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; color: var(--soft); font-size: 12px; font-weight: 600; small { color: var(--muted); font-size: 10px; } }
.reference-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
.reference-item { position: relative; min-width: 0; margin: 0; > span { display: block; margin-top: 5px; overflow: hidden; color: var(--muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; } }
.reference-preview-button, .reference-add { width: 100%; aspect-ratio: 1; border: 1px solid var(--line); border-radius: 7px; background: var(--field); }
.reference-preview-button {
  position: relative; display: block; padding: 0; cursor: zoom-in; overflow: hidden; transition: border-color 180ms ease;
  img { width: 100%; height: 100%; display: block; object-fit: cover; }
  svg { position: absolute; right: 6px; bottom: 6px; padding: 4px; box-sizing: content-box; border: 1px solid var(--line-strong); border-radius: 6px; color: var(--soft); background: rgba(13, 19, 26, 0.82); opacity: 0; transition: opacity 160ms ease; }
  &:hover { border-color: var(--line-strong); }
  &:hover svg, &:focus-visible svg { opacity: 1; }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
}
.reference-add { display: grid; place-items: center; align-content: center; gap: 5px; border-style: dashed; color: var(--tech-cyan); cursor: pointer; font-size: 10px; transition: border-color 160ms ease, background 160ms ease; &:hover { border-color: var(--line-strong); background: rgba(101, 207, 224, 0.08); } &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; } }
.reference-delete { position: absolute; top: 5px; right: 5px; width: 26px; height: 26px; display: grid; place-items: center; border: 1px solid var(--line-strong); border-radius: 6px; color: var(--danger); background: rgba(13, 19, 26, 0.86); cursor: pointer; &:hover { color: #ff9ba4; border-color: rgba(239, 125, 136, 0.6); background: rgba(239, 125, 136, 0.16); } &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; } }
.reference-error { display: grid; grid-template-columns: 14px minmax(0, 1fr); align-items: start; gap: 6px; margin: 8px 0 0; padding: 8px 10px; border: 1px solid rgba(239, 125, 136, 0.42); border-radius: 7px; color: var(--danger); background: rgba(239, 125, 136, 0.08); font-size: 11px; font-weight: 600; line-height: 1.5; svg { margin-top: 1px; } }
.reference-overlay { position: fixed; inset: 0; z-index: 30; display: grid; grid-template-rows: auto minmax(0, 1fr); padding: 28px; background: rgba(4, 7, 11, 0.82); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
.reference-dialog { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; &:focus { outline: none; } }
.reference-dialog-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 12px; h2 { margin: 0; color: var(--text); font-size: 16px; font-weight: 660; } p { margin: 4px 0 0; overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; } }
.reference-dialog-canvas { min-height: 0; display: grid; place-items: center; img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; box-shadow: 0 18px 60px rgba(0, 0, 0, 0.5); } }
.modal.reference-confirm { width: min(420px, 100%); text-align: center; h2 { margin: 0; } p { margin: 8px 0 18px; } }
.reference-confirm-icon { width: 46px; height: 46px; margin: 0 auto 14px; display: grid; place-items: center; border: 1px solid rgba(239, 125, 136, 0.5); border-radius: 50%; color: var(--danger); background: rgba(239, 125, 136, 0.1); }
.reference-confirm-actions { display: flex; gap: 10px; justify-content: center; .ghost-button, .confirm-delete-button { min-height: 38px; padding: 0 18px; } }
.confirm-delete-button { display: inline-flex; align-items: center; gap: 7px; border: 1px solid rgba(239, 125, 136, 0.5); border-radius: 7px; color: #fff; background: var(--danger); font-weight: 650; cursor: pointer; transition: background 160ms ease, border-color 160ms ease; &:hover { background: #f06673; border-color: rgba(239, 125, 136, 0.8); } &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; } }
</style>
