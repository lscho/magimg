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
        <PromptTemplateCard
          v-for="item in visibleTemplates"
          :key="item.id"
          :template="item"
          compact
          @use="emit('use', $event)"
        />
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.modal.template-modal {
  width: min(980px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}

.modal-heading-with-icon {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding-right: 46px;

  > div:first-child {
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    border: 1px solid rgba(120, 152, 245, 0.2);
    border-radius: 7px;
    color: var(--accent-strong);
    background: var(--accent-soft);
  }

  h2 {
    margin-top: 0;
  }

  p {
    margin: 4px 0 18px;
  }
}

.compact-filters {
  margin-bottom: 14px;
}

.template-modal-grid {
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-auto-rows: max-content;
  align-content: start;
  gap: 10px;
  overflow: auto;
  padding: 2px 4px 2px 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

@media (max-width: 600px) {
  .modal.template-modal {
    max-height: calc(100vh - 24px);
    padding: 18px;
  }

  .template-modal-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 420px) {
  .template-modal-grid {
    grid-template-columns: 1fr;
  }
}
</style>
