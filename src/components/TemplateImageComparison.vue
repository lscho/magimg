<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { ChevronsLeftRight } from "lucide-vue-next";
import type { PromptTemplate } from "@/types";

const props = defineProps<{ template: PromptTemplate }>();

const position = shallowRef(50);
const combinedPreview = computed(() => !props.template.sourceImage);
const sourceClipStyle = computed(() => ({
  clipPath: `inset(0 ${100 - position.value}% 0 0)`
}));
const dividerStyle = computed(() => ({ left: `${position.value}%` }));

watch(
  () => [props.template.previewImage, props.template.sourceImage],
  () => {
    position.value = 50;
  }
);

function updatePosition(event: Event) {
  position.value = Number((event.currentTarget as HTMLInputElement).value);
}
</script>

<template>
  <div
    class="template-comparison"
    :class="{ 'combined-preview': combinedPreview }"
  >
    <img
      class="comparison-image comparison-effect"
      :src="template.previewImage"
      :alt="`${template.title}生成结果`"
      draggable="false"
      loading="lazy"
      decoding="async"
    />

    <div class="comparison-source" :style="sourceClipStyle" aria-hidden="true">
      <img
        class="comparison-image"
        :src="template.sourceImage || template.previewImage"
        alt=""
        draggable="false"
        loading="lazy"
        decoding="async"
      />
    </div>

    <span class="comparison-label source-label">原图</span>
    <span class="comparison-label effect-label">生成结果</span>

    <span class="comparison-divider" :style="dividerStyle" aria-hidden="true">
      <i><ChevronsLeftRight :size="14" /></i>
    </span>

    <input
      class="comparison-range"
      type="range"
      min="0"
      max="100"
      step="1"
      :value="position"
      :aria-label="`拖动对比${template.title}的原图和生成结果`"
      :aria-valuetext="`${position}% 原图`"
      @input="updatePosition"
    />
  </div>
</template>

<style scoped lang="scss">
.template-comparison {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--field);

  &:focus-within {
    box-shadow: inset 0 0 0 2px var(--accent-strong);

    .comparison-divider i {
      color: var(--on-accent);
      background: var(--accent);
    }
  }
}

.comparison-image,
.comparison-source {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.comparison-image {
  display: block;
  object-fit: cover;
  pointer-events: none;
  user-select: none;
}

.comparison-source {
  z-index: 1;
  overflow: hidden;
  will-change: clip-path;
}

.comparison-label {
  pointer-events: none;
  position: absolute;
  z-index: 3;
  top: 8px;
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  color: #fff;
  background: rgba(8, 11, 16, 0.78);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.24);
  font-size: 9px;
  font-weight: 700;
}

.source-label { left: 8px; }

.effect-label {
  right: 8px;
  border-color: var(--accent-border);
  color: var(--accent-strong);
}

.comparison-divider {
  pointer-events: none;
  position: absolute;
  z-index: 3;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.48);
  transform: translateX(-1px);

  i {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.7);
    border-radius: 50%;
    color: #151923;
    background: #fff;
    box-shadow: 0 5px 16px rgba(0, 0, 0, 0.34);
    transform: translate(-50%, -50%);
    transition:
      color 0.18s ease,
      background-color 0.18s ease;
  }
}

.comparison-range {
  position: absolute;
  z-index: 4;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: ew-resize;
  touch-action: none;
}

.combined-preview {
  .comparison-image {
    width: 200%;
    max-width: none;
    object-fit: cover;
  }

  .comparison-effect { transform: translateX(-50%); }
}

@media (prefers-reduced-motion: reduce) {
  .comparison-divider i { transition: none; }
}
</style>
