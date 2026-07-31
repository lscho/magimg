<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from "vue";
import { LayoutTemplate, LoaderCircle, X } from "lucide-vue-next";
import TemplateMasonryGrid from "@/components/TemplateMasonryGrid.vue";
import { useAppStore } from "@/stores/app";
import type { GenerationMode, PromptTemplate } from "@/types";

const props = defineProps<{ mode: GenerationMode }>();
const emit = defineEmits<{ close: []; use: [template: PromptTemplate] }>();
const app = useAppStore();
const dialog = useTemplateRef<HTMLElement>("dialog");
const activeCategory = ref("全部");
const categories = computed(() => [
  "全部",
  ...Array.from(new Set(app.templates.filter((item) => item.mode === props.mode).map((item) => item.category)))
]);
const visibleTemplates = computed(() =>
  app.templates.filter(
    (item) => item.mode === props.mode && (activeCategory.value === "全部" || item.category === activeCategory.value)
  )
);

onMounted(() => {
  dialog.value?.focus();
  void app.refreshTemplates();
});
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section
      ref="dialog"
      class="modal template-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-modal-title"
      tabindex="-1"
      @keydown.esc="emit('close')"
    >
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

      <div v-if="app.templatesLoading" class="modal-empty-state" role="status">
        <LoaderCircle :size="28" />
        <strong>正在加载模板</strong>
      </div>
      <div v-else-if="app.templatesError" class="modal-empty-state">
        <strong>模板加载失败</strong>
        <span>{{ app.templatesError }}</span>
        <button class="secondary-button" type="button" @click="app.refreshTemplates">重新加载</button>
      </div>
      <div v-else-if="visibleTemplates.length" class="template-modal-scroll">
        <TemplateMasonryGrid
          :templates="visibleTemplates"
          compact
          @use="emit('use', $event)"
        />
      </div>
      <div v-else class="modal-empty-state">
        <strong>暂无可用模板</strong>
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

  &:focus {
    outline: none;
  }
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

.template-modal-scroll {
  min-height: 0;
  overflow: auto;
  padding: 2px 4px 2px 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.modal-empty-state {
  min-height: 220px;
  display: grid;
  place-content: center;
  place-items: center;
  gap: 9px;
  color: var(--muted);
  text-align: center;

  strong {
    color: var(--text);
    font-size: 13px;
  }

  span {
    font-size: 10px;
  }
}

@media (max-width: 600px) {
  .modal.template-modal {
    max-height: calc(100vh - 24px);
    padding: 18px;
  }
}
</style>
