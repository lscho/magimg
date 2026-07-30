<script setup lang="ts">
import { WandSparkles } from "lucide-vue-next";
import TemplateImageComparison from "@/components/TemplateImageComparison.vue";
import type { PromptTemplate } from "@/types";

withDefaults(defineProps<{ template: PromptTemplate; compact?: boolean }>(), {
  compact: false
});
const emit = defineEmits<{ use: [template: PromptTemplate] }>();
</script>

<template>
  <article class="template-card" :class="[template.mode, { compact }]">
    <div class="template-card-media">
      <div
        v-if="template.mode === 'text-to-image'"
        class="template-single-preview"
        :class="`crop-${template.previewCrop || 'full'}`"
      >
        <img
          :src="template.previewImage"
          :alt="`${template.title}效果预览`"
          loading="lazy"
          decoding="async"
        />
      </div>
      <TemplateImageComparison v-else :template="template" />

      <div class="template-card-overlay">
        <div class="template-card-copy">
          <div class="template-card-meta">
            <span>{{ template.category }}</span>
            <i v-for="tag in template.tags.slice(0, 1)" :key="tag">{{ tag }}</i>
          </div>
          <h2>{{ template.title }}</h2>
          <blockquote :title="template.prompt">{{ template.prompt }}</blockquote>
        </div>
        <button
          class="template-use"
          type="button"
          :aria-label="`使用${template.title}模板`"
          :title="`使用${template.title}模板`"
          @click="emit('use', template)"
        >
          <WandSparkles :size="14" aria-hidden="true" />
          <span>使用</span>
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
.template-card {
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  &:hover,
  &:focus-within {
    border-color: var(--line-strong);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);

    .template-card-overlay { opacity: 1; }
  }
}

.template-card-media {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--field);
}

.template-single-preview {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  &.crop-source,
  &.crop-effect {
    img {
      width: 200%;
      max-width: none;
      object-fit: cover;
    }
  }

  &.crop-effect img { transform: translateX(-50%); }
}

.template-card-overlay {
  pointer-events: none;
  position: absolute;
  z-index: 6;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
  padding: 46px 12px 12px;
  opacity: 0;
  color: #fff;
  background: linear-gradient(to top, rgba(4, 7, 11, 0.95) 0%, rgba(4, 7, 11, 0.52) 48%, transparent 78%);
  transition: opacity 0.2s ease;
}

.template-card-copy {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.template-card-meta {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;

  span,
  i {
    min-width: 0;
    overflow: hidden;
    padding: 4px 6px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.84);
    background: rgba(255, 255, 255, 0.08);
    font-size: 8px;
    font-style: normal;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span { color: var(--accent-strong); }
}

.template-card h2 {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: #fff;
  font-size: 13px;
  font-weight: 680;
  line-height: 1.45;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.template-card blockquote {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.82);
  font-size: 11px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.template-use {
  pointer-events: auto;
  min-width: 62px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid var(--accent-border);
  border-radius: 6px;
  color: var(--on-accent);
  background: var(--accent);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;

  &:hover,
  &:focus-visible { background: var(--accent-hover); }
}

.template-card.compact {
  .template-card-overlay { padding: 38px 10px 10px; }
  .template-card blockquote { -webkit-line-clamp: 2; }
}

@media (hover: none) {
  .template-card-overlay { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .template-card,
  .template-card-overlay { transition: none; }
}
</style>
