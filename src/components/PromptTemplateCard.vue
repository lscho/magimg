<script setup lang="ts">
import { ArrowRight, ArrowUpRight } from "lucide-vue-next";
import type { PromptTemplate } from "@/types";

withDefaults(defineProps<{ template: PromptTemplate; compact?: boolean }>(), {
  compact: false
});
const emit = defineEmits<{ use: [template: PromptTemplate] }>();
</script>

<template>
  <article class="template-card" :class="[template.mode, { compact }]">
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

<style scoped lang="scss">
.template-card {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease,
    transform 0.18s ease;

  &:hover {
    border-color: var(--line-strong);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
    transform: none;
  }

  &.compact {
    grid-template-rows: auto auto;

    blockquote {
      -webkit-line-clamp: 2;
    }
  }

  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 680;
  }

  blockquote {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    color: var(--soft);
    font-size: 11px;
    line-height: 1.65;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }
}

.template-visual {
  position: relative;
  overflow: hidden;
  border-radius: 7px;
  background-color: var(--surface-strong);

  &-single {
    aspect-ratio: 16 / 9;
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;

    &.crop-source,
    &.crop-effect {
      background-size: 200% auto;
    }

    &.crop-source {
      background-position: left center;
    }

    &.crop-effect {
      background-position: right center;
    }
  }

  &-comparison {
    aspect-ratio: 2 / 1;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.template-visual-single > span,
.comparison-pane > span {
  position: absolute;
  left: 9px;
  bottom: 9px;
  padding: 4px 7px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 4px;
  color: #fff;
  background: rgba(8, 11, 16, 0.78);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  font-size: 9px;
  font-weight: 700;
}

.comparison-pane {
  position: relative;
  min-width: 0;
  background-repeat: no-repeat;
  background-size: 200% auto;

  &.source {
    background-position: left center;
  }

  &.effect {
    background-position: right center;

    > span {
      right: 9px;
      left: auto;
      color: var(--on-accent);
      border-color: rgba(211, 220, 255, 0.32);
      background: rgba(120, 152, 245, 0.92);
    }
  }
}

.comparison-arrow {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 2px solid rgba(255, 255, 255, 0.82);
  border-radius: 50%;
  color: var(--accent-strong);
  background: rgba(16, 22, 29, 0.9);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.32);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  transform: translate(-50%, -50%);
}

.template-card-content {
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 10px;
  padding: 14px;
}

.template-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  > span {
    color: var(--accent-strong);
    font-size: 9px;
    font-weight: 800;
  }
}

.template-tags {
  display: flex;
  gap: 4px;
  overflow: hidden;

  i {
    padding: 3px 5px;
    border-radius: 4px;
    color: var(--muted);
    background: var(--surface-strong);
    font-size: 8px;
    font-style: normal;
    white-space: nowrap;
  }
}

.template-use {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border: 1px solid rgba(120, 152, 245, 0.18);
  border-radius: 5px;
  color: var(--accent-strong);
  background: rgba(120, 152, 245, 0.1);
  font-size: 11px;
  font-weight: 700;

  &:hover {
    border-color: rgba(120, 152, 245, 0.38);
    background: rgba(120, 152, 245, 0.16);
  }
}
</style>
