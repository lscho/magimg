<script setup lang="ts">
import { computed } from "vue";
import {
  Download,
  HardDriveDownload,
  LoaderCircle,
  RotateCw,
  Trash2
} from "lucide-vue-next";
import type { CutoutPhase } from "@/composables/useCutoutInference";
import type {
  CutoutModelDescriptor,
  CutoutModelStatus
} from "@/types";
import type { ModelDownloadProgress } from "@/services/cutoutModelManager";

const props = defineProps<{
  models: readonly CutoutModelDescriptor[];
  activeModelId: string;
  modelStatuses: Readonly<Record<string, CutoutModelStatus>>;
  phase: CutoutPhase;
  downloadProgress: ModelDownloadProgress | null;
  localModelsSupported: boolean;
}>();

const emit = defineEmits<{
  selectModel: [modelId: string];
  installModel: [modelId: string];
  removeModel: [modelId: string];
}>();

const activeModel = computed(
  () => props.models.find((model) => model.id === props.activeModelId) ?? null
);
const modelOperationActive = computed(
  () => ["downloading", "verifying", "installing"].includes(props.phase)
);
const operationLabel = computed(() => {
  if (props.phase === "verifying") return "正在校验";
  if (props.phase === "installing") return "正在安装";
  return "正在下载";
});
const progressPercent = computed(() => {
  const progress = props.downloadProgress;
  if (!progress?.totalBytes) return 0;
  return Math.min(100, Math.round(progress.receivedBytes / progress.totalBytes * 100));
});

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function statusLabel(status: CutoutModelStatus) {
  if (status === "ready") return "已下载";
  if (status === "downloading") return "处理中";
  if (status === "error") return "需重试";
  return "未下载";
}
</script>

<template>
  <section class="cutout-model-section" aria-labelledby="cutout-model-heading">
    <div class="cutout-model-heading">
      <h3 id="cutout-model-heading">本地模型</h3>
      <HardDriveDownload :size="14" aria-hidden="true" />
    </div>

    <div class="cutout-model-list" role="radiogroup" aria-label="选择抠图模型">
      <div
        v-for="model in models"
        :key="model.id"
        class="cutout-model-row"
        :class="{ active: model.id === activeModelId }"
      >
        <button
          class="cutout-model-choice"
          type="button"
          role="radio"
          :aria-checked="model.id === activeModelId"
          :disabled="phase !== 'idle'"
          @click="emit('selectModel', model.id)"
        >
          <span class="cutout-model-title">
            <strong>{{ model.name }}</strong>
            <span v-if="model.recommended" class="cutout-model-recommended">推荐</span>
          </span>
          <span class="cutout-model-description">{{ model.description }}</span>
          <span class="cutout-model-meta">
            {{ formatBytes(model.sizeBytes) }}
            <span aria-hidden="true">·</span>
            <span :class="`is-${modelStatuses[model.id] ?? 'missing'}`">
              {{ statusLabel(modelStatuses[model.id] ?? "missing") }}
            </span>
          </span>
        </button>

        <button
          v-if="modelStatuses[model.id] === 'ready'"
          class="cutout-model-action"
          type="button"
          :aria-label="`移除 ${model.name}`"
          :title="`移除 ${model.name}`"
          :disabled="phase !== 'idle'"
          @click="emit('removeModel', model.id)"
        >
          <Trash2 :size="15" aria-hidden="true" />
        </button>
        <button
          v-else
          class="cutout-model-action"
          type="button"
          :aria-label="`下载 ${model.name}`"
          :title="localModelsSupported ? `下载 ${model.name}` : '桌面客户端可下载模型'"
          :disabled="phase !== 'idle' || !localModelsSupported"
          @click="emit('installModel', model.id)"
        >
          <RotateCw
            v-if="modelStatuses[model.id] === 'error'"
            :size="15"
            aria-hidden="true"
          />
          <LoaderCircle
            v-else-if="modelStatuses[model.id] === 'downloading'"
            class="cutout-model-spinner"
            :size="15"
            aria-hidden="true"
          />
          <Download v-else :size="15" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div v-if="modelOperationActive && downloadProgress" class="cutout-model-progress" role="status">
      <div class="cutout-progress-label">
        <span>{{ operationLabel }} {{ activeModel?.name }}</span>
        <strong>{{ progressPercent }}%</strong>
      </div>
      <div class="cutout-progress-bar" aria-hidden="true">
        <span :style="{ width: `${progressPercent}%` }" />
      </div>
    </div>

    <p v-else-if="!localModelsSupported" class="cutout-model-browser-status">
      浏览器预览不加载本地模型
    </p>
  </section>
</template>

<style scoped lang="scss">
.cutout-model-section {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
}

.cutout-model-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--muted);

  h3 {
    margin: 0;
    color: var(--text);
    font-size: 12px;
    font-weight: 660;
  }
}

.cutout-model-list {
  display: grid;
  gap: 6px;
}

.cutout-model-row {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 34px;
  align-items: stretch;
  border: 1px solid var(--line);
  border-radius: 7px;
  overflow: hidden;
  background: var(--field);
  transition: border-color 160ms ease, background 160ms ease;

  &:hover,
  &:focus-within,
  &.active {
    border-color: var(--accent-border);
  }

  &.active {
    background: var(--accent-soft);
  }
}

.cutout-model-choice {
  min-width: 0;
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  &:disabled {
    cursor: not-allowed;
  }
}

.cutout-model-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--text);
    font-size: 11px;
    font-weight: 660;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.cutout-model-recommended {
  flex: 0 0 auto;
  padding: 1px 4px;
  border: 1px solid var(--accent-border);
  border-radius: 4px;
  color: var(--accent-strong);
  font-size: 8px;
  font-weight: 700;
}

.cutout-model-description,
.cutout-model-meta {
  min-width: 0;
  color: var(--muted);
  font-size: 9px;
  line-height: 1.35;
}

.cutout-model-description {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cutout-model-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-variant-numeric: tabular-nums;

  .is-ready { color: var(--success); }
  .is-downloading { color: var(--accent-strong); }
  .is-error { color: var(--danger); }
}

.cutout-model-action {
  width: 34px;
  min-height: 34px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-left: 1px solid var(--line);
  border-radius: 0;
  color: var(--muted);
  background: transparent;

  &:hover:not(:disabled),
  &:focus-visible {
    color: var(--accent-strong);
    background: var(--surface-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }
}

.cutout-model-progress {
  display: grid;
  gap: 6px;
}

.cutout-progress-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    flex: 0 0 auto;
    color: var(--accent-strong);
    font-size: 10px;
  }
}

.cutout-progress-bar {
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

.cutout-model-browser-status {
  margin: 0;
  color: var(--muted);
  font-size: 10px;
}

.cutout-model-spinner {
  animation: spin 0.9s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .cutout-model-row,
  .cutout-progress-bar span {
    transition: none;
  }

  .cutout-model-spinner {
    animation: none;
  }
}
</style>
