<script setup lang="ts">
import { computed, useId } from "vue";
import {
  Download,
  LoaderCircle,
  PackageCheck,
  RotateCw
} from "lucide-vue-next";
import type {
  CutoutPhase,
  CutoutResourceProgress,
  CutoutResourceStatus
} from "@/composables/useCutoutInference";

const props = defineProps<{
  status: CutoutResourceStatus;
  phase: CutoutPhase;
  progress: CutoutResourceProgress | null;
  downloadSizeBytes: number;
  localModelsSupported: boolean;
  title?: string;
  description?: string;
  installLabel?: string;
}>();

const emit = defineEmits<{
  install: [];
}>();
const headingId = useId();

const isInstalling = computed(
  () => ["downloading", "verifying", "installing"].includes(props.phase)
);
const operationLabel = computed(() => {
  if (props.phase === "verifying") return "正在校验资源";
  if (props.phase === "installing") return "正在安装资源";
  return "正在下载资源";
});
const downloadSizeLabel = computed(
  () => `${(props.downloadSizeBytes / 1024 / 1024).toFixed(1)} MB`
);
const resourceName = computed(() => props.title || "AI 抠图资源包");
const installAriaLabel = computed(
  () => `${props.status === "error" ? "重新下载" : "下载"}${resourceName.value}`
);
</script>

<template>
  <section class="cutout-resource-notice" :aria-labelledby="headingId">
    <div class="cutout-resource-summary">
      <PackageCheck :size="18" aria-hidden="true" />
      <div>
        <h3 :id="headingId">{{ title || '首次使用需下载资源包' }}</h3>
        <p v-if="!localModelsSupported">请在桌面客户端中下载并使用</p>
        <p v-else-if="status === 'error'">资源未完整安装，请重新下载</p>
        <p v-else>{{ description || '包含完整分割与边缘优化能力' }} · {{ downloadSizeLabel }}</p>
      </div>
    </div>

    <button
      class="cutout-resource-button"
      type="button"
      :disabled="isInstalling || !localModelsSupported"
      :aria-label="installAriaLabel"
      @click="emit('install')"
    >
      <LoaderCircle
        v-if="isInstalling"
        class="cutout-resource-spinner"
        :size="15"
        aria-hidden="true"
      />
      <RotateCw v-else-if="status === 'error'" :size="15" aria-hidden="true" />
      <Download v-else :size="15" aria-hidden="true" />
      {{ isInstalling ? "处理中" : status === "error" ? "重试" : installLabel || "下载资源包" }}
    </button>

    <div
      v-if="isInstalling && progress"
      class="cutout-resource-progress"
      role="status"
    >
      <div class="cutout-resource-progress-label">
        <span>{{ operationLabel }}</span>
        <strong>{{ progress.percent }}%</strong>
      </div>
      <div class="cutout-resource-progress-bar" aria-hidden="true">
        <span :style="{ width: `${progress.percent}%` }" />
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.cutout-resource-notice {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-subtle);
}

.cutout-resource-summary {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--tech-cyan);

  div {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  h3,
  p {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  h3 {
    color: var(--text);
    font-size: 11px;
    font-weight: 660;
  }

  p {
    color: var(--muted);
    font-size: 9px;
  }
}

.cutout-resource-button {
  min-width: 92px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid var(--accent-border);
  border-radius: 6px;
  color: var(--accent-strong);
  background: var(--accent-soft);
  font-size: 10px;
  font-weight: 650;

  &:hover:not(:disabled),
  &:focus-visible {
    color: #0a0f15;
    background: var(--accent);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.cutout-resource-progress {
  grid-column: 1 / -1;
  display: grid;
  gap: 5px;
}

.cutout-resource-progress-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-size: 9px;
  font-variant-numeric: tabular-nums;

  strong {
    color: var(--accent-strong);
    font-size: 9px;
  }
}

.cutout-resource-progress-bar {
  position: relative;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--line);

  span {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 2px;
    background: var(--accent);
    transition: width 160ms ease;
  }
}

.cutout-resource-spinner {
  animation: spin 0.9s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .cutout-resource-progress-bar span {
    transition: none;
  }

  .cutout-resource-spinner {
    animation: none;
  }
}
</style>
