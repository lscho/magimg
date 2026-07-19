<script setup lang="ts">
import { computed } from "vue";
import { ImagePlus, Images, Sparkles } from "lucide-vue-next";
import type { GenerationMode } from "@/types";

const props = defineProps<{
  mode: GenerationMode;
}>();

const isImageToImage = computed(() => props.mode === "image-to-image");
</script>

<template>
  <section class="generation-empty" aria-labelledby="generation-empty-title">
    <div
      class="empty-illustration"
      :class="{ 'is-image-to-image': isImageToImage }"
      aria-hidden="true"
    >
      <div class="illustration-frame">
        <span class="frame-corner corner-top-left" />
        <span class="frame-corner corner-top-right" />
        <span class="frame-corner corner-bottom-left" />
        <span class="frame-corner corner-bottom-right" />

        <Images v-if="isImageToImage" class="mode-icon" :size="76" :stroke-width="1.35" />
        <ImagePlus v-else class="mode-icon" :size="76" :stroke-width="1.35" />
        <span class="scan-line" />
      </div>
      <Sparkles class="spark-icon" :size="36" :stroke-width="1.5" />
    </div>

    <div class="empty-copy">
      <h2 id="generation-empty-title">准备开始创作</h2>
      <p>生成结果将在这里呈现</p>
    </div>
  </section>
</template>

<style scoped lang="scss">
.generation-empty {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  place-content: center;
  place-items: center;
  gap: 20px;
  padding: 32px;
  color: var(--text);
  text-align: center;
  user-select: none;
}

.empty-illustration {
  position: relative;
  width: 224px;
  height: 204px;
  display: grid;
  place-items: center;
  color: var(--accent-strong);
  animation: empty-illustration-enter 0.44s ease-out both;

  &.is-image-to-image {
    color: var(--tech-cyan);
  }
}

.illustration-frame {
  position: relative;
  width: 176px;
  height: 176px;
  display: grid;
  place-items: center;

  &::before {
    position: absolute;
    inset: 20px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--field);
    content: "";
  }
}

.frame-corner {
  position: absolute;
  z-index: 2;
  width: 28px;
  height: 28px;
  border-color: var(--line-strong);
  border-style: solid;
  opacity: 0.95;
}

.corner-top-left {
  top: 0;
  left: 0;
  border-width: 2px 0 0 2px;
  border-radius: 8px 0 0;
}

.corner-top-right {
  top: 0;
  right: 0;
  border-width: 2px 2px 0 0;
  border-color: var(--accent-strong);
  border-radius: 0 8px 0 0;
}

.corner-bottom-left {
  bottom: 0;
  left: 0;
  border-width: 0 0 2px 2px;
  border-color: var(--accent-strong);
  border-radius: 0 0 0 8px;
}

.corner-bottom-right {
  right: 0;
  bottom: 0;
  border-width: 0 2px 2px 0;
  border-radius: 0 0 8px;
}

.mode-icon {
  position: relative;
  z-index: 1;
  display: block;
  animation: mode-icon-enter 0.38s 0.08s ease-out both;
}

.scan-line {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 36px;
  right: 36px;
  height: 1px;
  background: var(--tech-cyan);
  opacity: 0;
  transform: translateY(-52px) scaleX(0.25);
  animation: scan-once 0.82s 0.16s ease-out both;
}

.spark-icon {
  position: absolute;
  z-index: 3;
  top: 3px;
  right: 5px;
  display: block;
  color: var(--accent-strong);
  animation: spark-enter 0.42s 0.18s ease-out both;
}

.empty-copy {
  display: grid;
  justify-items: center;
  gap: 7px;
  animation: empty-copy-enter 0.38s 0.08s ease-out both;

  h2,
  p {
    margin: 0;
    letter-spacing: 0;
  }

  h2 {
    color: var(--soft);
    font-size: 18px;
    font-weight: 660;
  }

  p {
    color: var(--muted);
    font-size: 12px;
    line-height: 1.5;
  }
}

@keyframes empty-illustration-enter {
  from {
    transform: translateY(6px) scale(0.96);
    opacity: 0;
  }

  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

@keyframes mode-icon-enter {
  from {
    transform: scale(0.86);
    opacity: 0;
  }

  to {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes scan-once {
  0% {
    transform: translateY(-52px) scaleX(0.25);
    opacity: 0;
  }

  22% {
    opacity: 0.8;
  }

  78% {
    opacity: 0.36;
  }

  100% {
    transform: translateY(52px) scaleX(1);
    opacity: 0;
  }
}

@keyframes spark-enter {
  from {
    transform: translate(-6px, 6px) scale(0.72);
    opacity: 0;
  }

  to {
    transform: translate(0, 0) scale(1);
    opacity: 1;
  }
}

@keyframes empty-copy-enter {
  from {
    transform: translateY(4px);
    opacity: 0;
  }

  to {
    transform: translateY(0);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .empty-illustration,
  .mode-icon,
  .scan-line,
  .spark-icon,
  .empty-copy {
    animation: none;
  }
}

@media (max-width: 600px) {
  .generation-empty {
    gap: 16px;
    padding: 24px 18px;
  }

  .empty-illustration {
    width: 192px;
    height: 174px;
  }

  .illustration-frame {
    width: 148px;
    height: 148px;

    &::before {
      inset: 18px;
    }
  }

  .frame-corner {
    width: 24px;
    height: 24px;
  }

  .mode-icon {
    width: 64px;
    height: 64px;
  }

  .scan-line {
    left: 30px;
    right: 30px;
  }

  .spark-icon {
    top: 2px;
    right: 3px;
    width: 30px;
    height: 30px;
  }
}
</style>
