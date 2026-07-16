<script setup lang="ts">
import { WandSparkles } from "lucide-vue-next";
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
    >
      <img
        :src="template.previewImage"
        :alt="`${template.title}效果预览`"
        loading="lazy"
        decoding="async"
      />
      <span>效果预览</span>
    </div>
    <div
      v-else
      class="template-visual-comparison"
      :class="{ 'combined-preview': !template.sourceImage }"
    >
      <div class="comparison-pane source">
        <img
          :src="template.sourceImage || template.previewImage"
          :alt="`${template.title}原图`"
          loading="lazy"
          decoding="async"
        />
        <span class="comparison-label">原图</span>
      </div>
      <div class="comparison-pane effect">
        <img
          :src="template.previewImage"
          :alt="`${template.title}效果图`"
          loading="lazy"
          decoding="async"
        />
        <span class="comparison-label">效果</span>
      </div>
    </div>

    <div class="template-card-content">
      <div class="template-card-top">
        <span>{{ template.category }}</span>
        <div class="template-tags">
          <i v-for="tag in template.tags.slice(0, 2)" :key="tag">{{ tag }}</i>
        </div>
      </div>
      <div class="template-title-row">
        <h2>{{ template.title }}</h2>
        <button
          class="template-use"
          type="button"
          :aria-label="`使用${template.title}模板`"
          :title="`使用${template.title}模板`"
          @click="emit('use', template)"
        >
          <WandSparkles :size="14" />
          <span>使用</span>
        </button>
      </div>
      <blockquote :title="template.prompt">{{ template.prompt }}</blockquote>
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
      min-height: calc(2em * 1.65);
      -webkit-line-clamp: 2;
    }

    .template-use {
      height: 30px;
      min-width: 58px;
    }
  }

  h2 {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    font-size: 14px;
    font-weight: 680;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }

  blockquote {
    display: -webkit-box;
    min-height: calc(3em * 1.65);
    margin: 0;
    overflow: hidden;
    color: var(--text);
    font-size: 12px;
    line-height: 1.6;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }
}

.template-visual {
  position: relative;
  overflow: hidden;
  border-radius: 7px;
  background-color: var(--surface-strong);

  img {
    display: block;
    width: 100%;
    height: auto;
  }

  &-single {
    &.crop-source,
    &.crop-effect {
      aspect-ratio: 1;

      img {
        width: 200%;
        max-width: none;
      }
    }

    &.crop-effect img {
      transform: translateX(-50%);
    }
  }
}

.template-visual-single > span {
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

.template-visual-comparison {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
  overflow: hidden;
  border-bottom: 1px solid var(--line);
  background: var(--field);
}

.comparison-label {
  position: absolute;
  z-index: 2;
  top: 8px;
  left: 8px;
  min-height: 22px;
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 4px;
  color: #fff;
  background: rgba(8, 11, 16, 0.82);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.26);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  text-shadow: 0 1px 2px #000;
}

.comparison-pane {
  position: relative;
  min-width: 0;
  overflow: hidden;
  background-color: var(--surface-strong);

  img {
    display: block;
    width: 100%;
    height: auto;
  }

  &.source {
    border-right: 1px solid rgba(255, 255, 255, 0.3);

    &::after {
      position: absolute;
      z-index: 1;
      inset: 0;
      content: "";
      pointer-events: none;
      background: rgba(4, 7, 11, 0.26);
      box-shadow: inset -18px 0 30px rgba(0, 0, 0, 0.28);
    }
  }

  &.effect {
    box-shadow: inset 0 0 0 1px rgba(101, 207, 224, 0.08);

    .comparison-label {
      right: 8px;
      left: auto;
      border-color: rgba(101, 207, 224, 0.46);
    }
  }
}

.combined-preview {
  .comparison-pane {
    aspect-ratio: 1;

    img {
      width: 200%;
      max-width: none;
    }
  }

  .effect img {
    transform: translateX(-50%);
  }
}

.template-card-content {
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 9px;
  padding: 12px;
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

.template-title-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
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
  min-width: 64px;
  height: 32px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 10px;
  border: 1px solid var(--accent-border);
  border-radius: 6px;
  color: var(--on-accent);
  background: var(--accent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.26);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;

  &:hover {
    background: var(--accent-hover);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.3),
      0 6px 16px rgba(59, 83, 168, 0.22);
  }
}

@media (max-width: 560px) {
  .comparison-label {
    top: 6px;
    left: 6px;
  }

  .comparison-pane.effect .comparison-label {
    right: 6px;
  }
}
</style>
