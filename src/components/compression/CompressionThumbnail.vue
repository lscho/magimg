<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch
} from "vue";
import { Image as ImageIcon, ImageOff, LoaderCircle } from "lucide-vue-next";
import { loadCompressionThumbnail } from "@/services/imageCompression";

const props = defineProps<{
  sessionId: string;
  itemId: string;
  alt: string;
}>();

interface PreviewPosition {
  left: number;
  top: number;
  size: number;
}

type NearViewportCallback = () => void;

const nearViewportCallbacks = new WeakMap<Element, NearViewportCallback>();
let nearViewportObserver: IntersectionObserver | null = null;

function getNearViewportObserver() {
  if (nearViewportObserver || typeof IntersectionObserver === "undefined") {
    return nearViewportObserver;
  }
  nearViewportObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const callback = nearViewportCallbacks.get(entry.target);
      nearViewportObserver?.unobserve(entry.target);
      nearViewportCallbacks.delete(entry.target);
      callback?.();
    }
  }, { rootMargin: "200px 0px" });
  return nearViewportObserver;
}

function observeNearViewport(element: Element, callback: NearViewportCallback) {
  const observer = getNearViewportObserver();
  if (!observer) {
    callback();
    return;
  }
  nearViewportCallbacks.set(element, callback);
  observer.observe(element);
}

function stopObserving(element: Element | null) {
  if (!element) return;
  nearViewportObserver?.unobserve(element);
  nearViewportCallbacks.delete(element);
}

const thumbnailRef = useTemplateRef<HTMLButtonElement>("thumbnail");
const imageUrl = shallowRef("");
const loading = shallowRef(false);
const failed = shallowRef(false);
const preview = shallowRef<PreviewPosition | null>(null);
const previewId = computed(() => `compression-thumbnail-preview-${props.itemId}`);
let observedElement: HTMLButtonElement | null = null;
let loadVersion = 0;

function revokeImageUrl() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = "";
}

function removePreviewListeners() {
  window.removeEventListener("resize", closePreview);
  window.removeEventListener("scroll", closePreview, true);
  window.removeEventListener("keydown", handlePreviewKeydown);
}

function closePreview() {
  preview.value = null;
  removePreviewListeners();
}

function handlePreviewKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closePreview();
}

function openPreview() {
  const element = thumbnailRef.value;
  if (!element || !imageUrl.value) return;
  const bounds = element.getBoundingClientRect();
  const padding = 12;
  const gap = 12;
  const size = Math.min(320, window.innerWidth - padding * 2, window.innerHeight - padding * 2);
  const canPlaceRight = bounds.right + gap + size <= window.innerWidth - padding;
  let left = canPlaceRight ? bounds.right + gap : bounds.left - size - gap;
  left = Math.min(Math.max(padding, left), window.innerWidth - size - padding);
  const top = Math.min(
    Math.max(padding, bounds.top + bounds.height / 2 - size / 2),
    window.innerHeight - size - padding
  );
  preview.value = { left, top, size };
  removePreviewListeners();
  window.addEventListener("resize", closePreview);
  window.addEventListener("scroll", closePreview, true);
  window.addEventListener("keydown", handlePreviewKeydown);
}

function closePreviewIfInactive() {
  window.requestAnimationFrame(() => {
    const element = thumbnailRef.value;
    if (element?.matches(":hover") || document.activeElement === element) return;
    closePreview();
  });
}

async function loadThumbnail() {
  if (loading.value || imageUrl.value) return;
  const version = ++loadVersion;
  loading.value = true;
  failed.value = false;
  try {
    const bytes = await loadCompressionThumbnail(props.sessionId, props.itemId);
    if (version !== loadVersion) return;
    imageUrl.value = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    const element = thumbnailRef.value;
    if (element?.matches(":hover") || document.activeElement === element) openPreview();
  } catch {
    if (version === loadVersion) failed.value = true;
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function scheduleLoad() {
  stopObserving(observedElement);
  await nextTick();
  observedElement = thumbnailRef.value;
  if (observedElement) observeNearViewport(observedElement, () => void loadThumbnail());
}

function resetThumbnail() {
  loadVersion += 1;
  closePreview();
  stopObserving(observedElement);
  observedElement = null;
  loading.value = false;
  failed.value = false;
  revokeImageUrl();
  void scheduleLoad();
}

watch(
  () => [props.sessionId, props.itemId],
  resetThumbnail
);

onMounted(() => void scheduleLoad());
onBeforeUnmount(() => {
  loadVersion += 1;
  closePreview();
  stopObserving(observedElement);
  revokeImageUrl();
});
</script>

<template>
  <button
    ref="thumbnail"
    class="compression-thumbnail"
    type="button"
    :aria-label="`放大预览 ${alt}`"
    :aria-describedby="preview ? previewId : undefined"
    title="放大预览"
    @pointerenter="openPreview"
    @pointerleave="closePreviewIfInactive"
    @click="openPreview"
    @focus="openPreview"
    @blur="closePreviewIfInactive"
    @keydown.esc="closePreview"
  >
    <img v-if="imageUrl" :src="imageUrl" alt="" />
    <LoaderCircle v-else-if="loading" class="thumbnail-spinner" :size="14" aria-hidden="true" />
    <ImageOff v-else-if="failed" :size="15" aria-hidden="true" />
    <ImageIcon v-else :size="15" aria-hidden="true" />
  </button>

  <Teleport to="body">
    <div
      v-if="preview && imageUrl"
      :id="previewId"
      class="compression-thumbnail-preview"
      role="tooltip"
      :style="{
        left: `${preview.left}px`,
        top: `${preview.top}px`,
        width: `${preview.size}px`,
        height: `${preview.size}px`
      }"
    >
      <img :src="imageUrl" :alt="`${alt} 放大预览`" />
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.compression-thumbnail,
.compression-thumbnail-preview {
  display: grid;
  place-items: center;
  background-color: #17202a;
  background-image:
    linear-gradient(45deg, rgba(241, 244, 248, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(241, 244, 248, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(241, 244, 248, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(241, 244, 248, 0.08) 75%);
}

.compression-thumbnail {
  position: relative;
  width: 42px;
  height: 42px;
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  color: var(--muted);
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-size: 12px 12px;

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }

  &:hover,
  &:focus-visible {
    border-color: var(--accent-border);
    color: var(--soft);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
}

.compression-thumbnail-preview {
  position: fixed;
  z-index: 45;
  overflow: hidden;
  padding: 10px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.42);
  pointer-events: none;

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }
}

.thumbnail-spinner {
  animation: thumbnail-spin 0.9s linear infinite;
}

@keyframes thumbnail-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .thumbnail-spinner { animation-duration: 1.8s; }
}
</style>
