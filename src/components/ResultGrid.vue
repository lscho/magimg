<script setup lang="ts">
import { Download, FolderOpen, Image, Maximize2, RotateCcw, Sparkles } from "lucide-vue-next";
import { openDirectory } from "@/services/desktop";
import type { GenerationRecord } from "@/types";

defineProps<{
  record: GenerationRecord | null;
  loading: boolean;
  saveDirectory: string;
}>();

const emit = defineEmits<{
  regenerate: [];
}>();
</script>

<template>
  <section class="result-panel">
    <div class="panel-heading">
      <div>
        <span class="section-kicker"><Sparkles :size="13" /> OUTPUT</span>
        <h2>生成结果</h2>
      </div>
      <div class="toolbar">
        <button class="icon-button result-tool" :disabled="!saveDirectory" title="打开输出文件夹" aria-label="打开输出文件夹" @click="openDirectory(saveDirectory)">
          <FolderOpen :size="16" />
        </button>
        <button class="icon-button result-tool" title="全部下载" aria-label="全部下载">
          <Download :size="16" />
        </button>
      </div>
    </div>

    <div v-if="loading" class="image-grid">
      <div v-for="item in 4" :key="item" class="image-skeleton" />
    </div>
    <div v-else-if="record?.images.length" class="image-grid">
      <figure v-for="image in record.images" :key="image.id" class="result-image">
        <img :src="image.remoteUrl" alt="生成图片" />
        <figcaption>
          <button class="icon-button" aria-label="放大查看"><Maximize2 :size="17" /></button>
          <button class="icon-button" aria-label="重新生成" @click="emit('regenerate')"><RotateCcw :size="17" /></button>
          <button class="icon-button" aria-label="保存图片"><Download :size="17" /></button>
        </figcaption>
      </figure>
    </div>
    <div v-else class="empty-state">
      <div class="empty-visual">
        <Image :size="34" />
        <span><Sparkles :size="15" /></span>
      </div>
      <strong>等待你的第一个灵感</strong>
      <span>完善左侧描述与参数，生成的作品会在这里呈现。</span>
    </div>
  </section>
</template>
