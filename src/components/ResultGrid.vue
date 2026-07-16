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
