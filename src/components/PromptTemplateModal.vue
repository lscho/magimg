<script setup lang="ts">
import { computed, ref } from "vue";
import { LayoutTemplate, X } from "lucide-vue-next";
import PromptTemplateCard from "@/components/PromptTemplateCard.vue";
import { promptTemplates, templateCategories } from "@/constants/promptTemplates";
import type { GenerationMode, PromptTemplate } from "@/types";

const props = defineProps<{ mode: GenerationMode }>();
const emit = defineEmits<{ close: []; use: [template: PromptTemplate] }>();
const activeCategory = ref("全部");
const categories = computed(() => templateCategories(props.mode));
const visibleTemplates = computed(() =>
  promptTemplates.filter((item) => item.mode === props.mode && (activeCategory.value === "全部" || item.category === activeCategory.value))
);
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal template-modal" role="dialog" aria-modal="true" aria-labelledby="template-modal-title">
      <button class="icon-button modal-close" aria-label="关闭模板广场" @click="emit('close')"><X :size="18" /></button>
      <div class="modal-heading-with-icon">
        <div><LayoutTemplate :size="20" /></div>
        <div>
          <h2 id="template-modal-title">{{ mode === "text-to-image" ? "文生图" : "图生图" }}模板</h2>
          <p>选择模板后将替换当前提示词。</p>
        </div>
      </div>

      <div class="category-filters compact-filters">
        <button
          v-for="category in categories"
          :key="category"
          type="button"
          :class="{ active: activeCategory === category }"
          @click="activeCategory = category"
        >
          {{ category }}
        </button>
      </div>

      <div class="template-modal-grid" :class="{ 'comparison-grid': mode === 'image-to-image' }">
        <PromptTemplateCard v-for="item in visibleTemplates" :key="item.id" :template="item" @use="emit('use', $event)" />
      </div>
    </section>
  </div>
</template>
