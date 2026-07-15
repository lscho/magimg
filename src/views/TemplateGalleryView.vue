<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ImagePlus, Wand2 } from "lucide-vue-next";
import PromptTemplateCard from "@/components/PromptTemplateCard.vue";
import { promptTemplates, templateCategories } from "@/constants/promptTemplates";
import { useAppStore } from "@/stores/app";
import type { GenerationMode, PromptTemplate } from "@/types";

const app = useAppStore();
const router = useRouter();
const activeMode = ref<GenerationMode>("text-to-image");
const activeCategory = ref("全部");
const categories = computed(() => templateCategories(activeMode.value));
const visibleTemplates = computed(() =>
  promptTemplates.filter(
    (item) => item.mode === activeMode.value && (activeCategory.value === "全部" || item.category === activeCategory.value)
  )
);

watch(activeMode, () => {
  activeCategory.value = "全部";
});

function useTemplate(template: PromptTemplate) {
  app.selectTemplate(template);
  void router.push(`/generate/${template.mode}`);
}
</script>

<template>
  <section class="page-view template-gallery-view">
    <div class="page-heading template-page-heading">
      <div>
        <span class="section-kicker">PROMPT LIBRARY</span>
        <h1>模板广场</h1>
        <p>从经过整理的提示词开始创作，再根据需要自由调整。</p>
      </div>
      <div class="template-mode-switch" aria-label="模板类型">
        <button :class="{ active: activeMode === 'text-to-image' }" @click="activeMode = 'text-to-image'">
          <Wand2 :size="15" /> 文生图
        </button>
        <button :class="{ active: activeMode === 'image-to-image' }" @click="activeMode = 'image-to-image'">
          <ImagePlus :size="15" /> 图生图
        </button>
      </div>
    </div>

    <div class="category-filters">
      <button
        v-for="category in categories"
        :key="category"
        :class="{ active: activeCategory === category }"
        @click="activeCategory = category"
      >
        {{ category }}
      </button>
    </div>

    <div class="template-grid" :class="{ 'comparison-grid': activeMode === 'image-to-image' }">
      <PromptTemplateCard v-for="item in visibleTemplates" :key="item.id" :template="item" @use="useTemplate" />
    </div>
  </section>
</template>
