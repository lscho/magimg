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
const columnCount = shallowRef(4);
let resizeObserver: ResizeObserver | null = null;

const columns = computed(() => {
  const result = Array.from({ length: columnCount.value }, () => [] as PromptTemplate[]);

  props.templates.forEach((template, index) => {
    result[index % columnCount.value]?.push(template);
  });

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

function updateColumnCount(width: number) {
  if (width >= 840) columnCount.value = 4;
  else if (width >= 640) columnCount.value = 3;
  else if (width >= 440) columnCount.value = 2;
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
        v-for="item in column"
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
