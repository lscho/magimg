<script setup lang="ts">
import { computed } from "vue";
import { Download, FolderOpen, Image, LoaderCircle, Maximize2, RotateCcw } from "lucide-vue-next";
import { openDirectory } from "@/services/desktop";
import type { GeneratedImage, GenerationRecord } from "@/types";

const props = defineProps<{
  record: GenerationRecord | null;
  loading: boolean;
  saveDirectory: string;
}>();

const emit = defineEmits<{
  regenerate: [];
}>();

const resultImages = computed(() => props.record?.images ?? []);
const isSingleResult = computed(() => resultImages.value.length === 1);

function imageFrameStyle(image: GeneratedImage) {
  return isSingleResult.value ? undefined : { aspectRatio: `${image.width} / ${image.height}` };
}
</script>

<template>
  <section class="result-panel">
    <div class="result-stage">
      <div class="toolbar result-toolbar">
        <button class="icon-button result-tool" :disabled="!saveDirectory" title="打开输出文件夹" aria-label="打开输出文件夹" @click="openDirectory(saveDirectory)">
          <FolderOpen :size="16" />
        </button>
        <button class="icon-button result-tool" :disabled="!resultImages.length" title="全部下载" aria-label="全部下载">
          <Download :size="16" />
        </button>
      </div>

      <div v-if="loading" class="result-loading" role="status" aria-live="polite">
        <div class="image-skeleton" />
        <span><LoaderCircle :size="18" /> 正在创作...</span>
      </div>
      <div v-else-if="resultImages.length" class="image-grid" :class="{ 'single-result': isSingleResult }">
        <figure
          v-for="(image, index) in resultImages"
          :key="image.id"
          class="result-image"
          :style="imageFrameStyle(image)"
        >
          <img :src="image.remoteUrl" :alt="`生成图片 ${index + 1}`" />
          <figcaption>
            <button class="icon-button" type="button" aria-label="放大查看"><Maximize2 :size="17" /></button>
            <button class="icon-button" type="button" aria-label="重新生成" @click="emit('regenerate')"><RotateCcw :size="17" /></button>
            <button class="icon-button" type="button" aria-label="保存图片"><Download :size="17" /></button>
          </figcaption>
        </figure>
      </div>
      <div v-else class="empty-state">
        <div class="empty-visual">
          <Image :size="34" />
        </div>
        <strong>等待你的第一个灵感</strong>
        <span>在右侧完善画面描述与参数，生成的作品会在这里呈现。</span>
      </div>
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
  padding: 32px;

  > .empty-state {
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

.result-toolbar {
  position: absolute;
  z-index: 4;
  top: 14px;
  right: 14px;

  :deep(.icon-button) {
    border-color: rgba(223, 230, 239, 0.16);
    color: var(--text);
    background: rgba(16, 22, 29, 0.84);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }
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

  img {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: block;
    object-fit: contain;
  }

  figcaption {
    position: absolute;
    right: 10px;
    bottom: 10px;
    display: flex;
    gap: 6px;
    opacity: 0;
    transform: translateY(5px);
    transition:
      opacity 0.18s ease,
      transform 0.18s ease;

    .icon-button {
      color: var(--text);
      border-color: rgba(223, 230, 239, 0.16);
      background: rgba(16, 22, 29, 0.84);
      -webkit-backdrop-filter: blur(10px);
      backdrop-filter: blur(10px);
    }
  }

  &:hover figcaption,
  &:focus-within figcaption {
    opacity: 1;
    transform: translateY(0);
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
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: linear-gradient(110deg, #111820, #1c2a3e, #111820);
  background-size: 240% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

.result-loading {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  place-items: center;

  .image-skeleton {
    width: 100%;
    height: 100%;
  }

  > span {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 11px;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    color: var(--soft);
    background: rgba(21, 29, 39, 0.94);
    font-size: 11px;

    svg {
      color: var(--accent);
      animation: spin 0.9s linear infinite;
    }
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
    padding: 20px;
  }

  .image-grid {
    grid-template-columns: 1fr;
    overflow: auto;
  }
}
</style>
