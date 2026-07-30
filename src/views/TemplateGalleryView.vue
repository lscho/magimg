<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { ImagePlus, LayoutTemplate, LoaderCircle, Wand2 } from "lucide-vue-next";
import PromptTemplateCard from "@/components/PromptTemplateCard.vue";
import { useAppStore } from "@/stores/app";
import type { GenerationMode, PromptTemplate } from "@/types";

const app = useAppStore();
const router = useRouter();
const activeMode = shallowRef<GenerationMode>("text-to-image");
const activeCategory = shallowRef("全部");
const categories = computed(() => [
  "全部",
  ...Array.from(
    new Set(app.templates.filter((item) => item.mode === activeMode.value).map((item) => item.category))
  )
]);
const visibleTemplates = computed(() =>
  app.templates.filter(
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
      <div class="template-heading-copy">
        <span class="section-kicker">PROMPT LIBRARY</span>
        <h1>模板广场</h1>
        <p>精选自幻画 AI 优秀案例，为创作提供更好的起点。</p>
      </div>
      <div class="template-mode-switch" role="group" aria-label="模板类型">
        <button
          type="button"
          :class="{ active: activeMode === 'text-to-image' }"
          :aria-pressed="activeMode === 'text-to-image'"
          @click="activeMode = 'text-to-image'"
        >
          <Wand2 :size="15" /> 文生图
        </button>
        <button
          type="button"
          :class="{ active: activeMode === 'image-to-image' }"
          :aria-pressed="activeMode === 'image-to-image'"
          @click="activeMode = 'image-to-image'"
        >
          <ImagePlus :size="15" /> 图生图
        </button>
      </div>
    </div>

    <div class="template-toolbar">
      <div class="category-filters" role="group" aria-label="模板分类">
        <button
          v-for="category in categories"
          :key="category"
          type="button"
          :class="{ active: activeCategory === category }"
          :aria-pressed="activeCategory === category"
          @click="activeCategory = category"
        >
          {{ category }}
        </button>
      </div>
      <span class="template-result-count">{{ visibleTemplates.length }} 项</span>
    </div>

    <div v-if="app.templatesLoading" class="empty-state full" role="status">
      <div class="empty-visual"><LoaderCircle :size="30" /></div>
      <strong>正在加载模板</strong>
    </div>
    <div v-else-if="app.templatesError" class="empty-state full">
      <div class="empty-visual"><LayoutTemplate :size="30" /></div>
      <strong>模板加载失败</strong>
      <span>{{ app.templatesError }}</span>
      <button class="secondary-button" type="button" @click="app.refreshTemplates">重新加载</button>
    </div>
    <div v-else-if="visibleTemplates.length" class="template-grid">
      <PromptTemplateCard
        v-for="item in visibleTemplates"
        :key="item.id"
        :template="item"
        @use="useTemplate"
      />
    </div>
    <div v-else class="empty-state full">
      <div class="empty-visual"><LayoutTemplate :size="30" /></div>
      <strong>暂无可用模板</strong>
    </div>
  </section>
</template>

<style scoped lang="scss">
.template-page-heading {
  align-items: center;
  margin-bottom: 0;
  padding-bottom: 18px;
}

.template-heading-copy {
  min-width: 0;
}

.template-mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-subtle);

  button {
    min-width: 108px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border-radius: 5px;
    color: var(--muted);
    background: transparent;
    font-size: 12px;
    font-weight: 600;

    &:hover {
      color: var(--soft);
      background: var(--surface-strong);
    }

    &.active {
      color: var(--accent-strong);
      background: var(--accent-soft);
      box-shadow: none;
    }
  }
}

.template-toolbar {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--line);
}

.category-filters {
  min-width: 0;
  margin: 0;
  padding: 12px 0;
}

.template-result-count {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 264px);
  grid-auto-rows: 264px;
  align-items: start;
  gap: 12px;
}

@media (max-width: 900px) {
  .template-page-heading {
    align-items: flex-start;
  }

}

@media (max-width: 600px) {
  .template-page-heading {
    display: grid;
  }

  .template-mode-switch {
    width: 100%;

    button {
      min-width: 0;
    }
  }

  .template-toolbar {
    align-items: flex-start;
  }

  .category-filters {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .template-result-count {
    padding-top: 21px;
  }

  .template-grid { justify-content: center; }
}

</style>
