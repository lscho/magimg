<script setup lang="ts">
import { ArrowRight, ArrowUpRight } from "lucide-vue-next";
import type { PromptTemplate } from "@/types";

defineProps<{ template: PromptTemplate }>();
const emit = defineEmits<{ use: [template: PromptTemplate] }>();
</script>

<template>
  <article class="template-card" :class="template.mode">
    <div
      v-if="template.mode === 'text-to-image'"
      class="template-visual template-visual-single"
      :class="`crop-${template.previewCrop || 'full'}`"
      :style="{ backgroundImage: `url(${template.previewImage})` }"
      role="img"
      :aria-label="`${template.title}效果预览`"
    >
      <span>效果预览</span>
    </div>
    <div v-else class="template-visual template-visual-comparison">
      <div
        class="comparison-pane source"
        :style="{ backgroundImage: `url(${template.previewImage})` }"
        role="img"
        :aria-label="`${template.title}源图`"
      >
        <span>源图</span>
      </div>
      <div class="comparison-arrow" aria-hidden="true"><ArrowRight :size="14" /></div>
      <div
        class="comparison-pane effect"
        :style="{ backgroundImage: `url(${template.previewImage})` }"
        role="img"
        :aria-label="`${template.title}效果图`"
      >
        <span>效果图</span>
      </div>
    </div>

    <div class="template-card-content">
      <div class="template-card-top">
        <span>{{ template.category }}</span>
        <div class="template-tags">
          <i v-for="tag in template.tags.slice(0, 2)" :key="tag">{{ tag }}</i>
        </div>
      </div>
      <h2>{{ template.title }}</h2>
      <blockquote>{{ template.prompt }}</blockquote>
      <button class="template-use" type="button" @click="emit('use', template)">
        使用模板 <ArrowUpRight :size="15" />
      </button>
    </div>
  </article>
</template>
