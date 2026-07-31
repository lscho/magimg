<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from "vue";
import PromptTemplateCard from "@/components/PromptTemplateCard.vue";
import type { PromptTemplate } from "@/types";

const props = withDefaults(defineProps<{
  templates: PromptTemplate[];
  compact?: boolean;
}>(), {
  compact: false
});

const emit = defineEmits<{ use: [template: PromptTemplate] }>();
const grid = useTemplateRef<HTMLElement>("grid");
const columnCount = shallowRef(3);
let resizeObserver: ResizeObserver | null = null;

const columns = computed(() => {
  const result = Array.from({ length: columnCount.value }, () => ({
    estimatedHeight: 0,
    items: [] as PromptTemplate[]
  }));

  for (const template of props.templates) {
    const target = result.reduce((shortest, column) =>
      column.estimatedHeight < shortest.estimatedHeight ? column : shortest
    );
    target.items.push(template);
    target.estimatedHeight += estimatedAspectHeight(template) + 0.04;
  }

  return result;
});

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry) updateColumnCount(entry.contentRect.width);
  });
  if (grid.value) {
    resizeObserver.observe(grid.value);
    updateColumnCount(grid.value.clientWidth);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});

function estimatedAspectHeight(template: PromptTemplate) {
  if (template.width && template.height) return template.height / template.width;
  if (template.previewCrop && template.previewCrop !== "full") return 1;
  return 1;
}

function updateColumnCount(width: number) {
  if (width >= 840) columnCount.value = 3;
  else if (width >= 540) columnCount.value = 2;
  else columnCount.value = 1;
}
</script>

<template>
  <div
    ref="grid"
    class="template-masonry-grid"
    :style="{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }"
  >
    <div v-for="(column, index) in columns" :key="index" class="template-masonry-column">
      <PromptTemplateCard
        v-for="item in column.items"
        :key="item.id"
        :template="item"
        :compact="compact"
        @use="emit('use', $event)"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.template-masonry-grid {
  width: 100%;
  display: grid;
  align-items: start;
  gap: 12px;
}

.template-masonry-column {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 12px;
}
</style>
