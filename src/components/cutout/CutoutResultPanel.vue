<script setup lang="ts">
import { computed } from "vue";
import {
  Check,
  Clipboard,
  Download,
  LoaderCircle,
  PackageOpen,
  Sparkles,
  X
} from "lucide-vue-next";
import CutoutResourceNotice from "./CutoutResourceNotice.vue";
import type {
  CutoutPhase,
  CutoutProgress,
  CutoutResourceProgress,
  CutoutResourceStatus
} from "@/composables/useCutoutInference";
import type { CutoutResult } from "@/types";

const props = defineProps<{
  results: CutoutResult[];
  phase: CutoutPhase;
  resourceStatus: CutoutResourceStatus;
  resourceProgress: CutoutResourceProgress | null;
  resourceDownloadSizeBytes: number;
  progress: CutoutProgress | null;
  error: string;
  copyingId: string | null;
  savingId: string | null;
  exportingAll: boolean;
  hasImage: boolean;
  selectionCount: number;
  localModelsSupported: boolean;
  cost: number;
  balance: number;
  isLoggedIn: boolean;
  insufficientCredits: boolean;
}>();

const emit = defineEmits<{
  installResources: [];
  segment: [];
  cancel: [];
  exportAll: [];
  copyResult: [result: CutoutResult];
  saveResult: [result: CutoutResult];
  removeResult: [id: string];
}>();

const isWorking = computed(() => props.phase !== "idle");
const canSegment = computed(
  () =>
    props.phase === "idle" &&
    props.isLoggedIn &&
    !props.insufficientCredits &&
    props.hasImage &&
    props.selectionCount > 0 &&
    props.resourceStatus === "ready"
);
const segmentPercent = computed(() => {
  const progress = props.progress;
  if (!progress?.total) return 0;
  return Math.min(100, Math.round(progress.current / progress.total * 100));
});
const processingLabel = computed(
  () => props.progress?.stage === "refining" ? "正在精修" : "正在分割"
);
const processingButtonLabel = computed(
  () => props.progress?.stage === "refining" ? "精修中" : "分割中"
);
const missingCredits = computed(() => Math.max(0, props.cost - props.balance));
const segmentButtonLabel = computed(() => {
  if (props.phase === "processing") return processingButtonLabel.value;
  if (!props.isLoggedIn) return "登录后抠图";
  if (props.insufficientCredits) {
    return missingCredits.value > 0
      ? `积分不足，还需 ${missingCredits.value} 积分`
      : "积分不足，请先充值";
  }
  return "一键抠图";
});
const segmentButtonDisabled = computed(
  () => props.isLoggedIn && (props.insufficientCredits || !canSegment.value)
);
const visibleError = computed(() => (props.insufficientCredits ? "" : props.error));
</script>

<template>
  <aside class="cutout-result-panel" aria-label="抠图结果">
    <header class="cutout-result-header">
      <div>
        <h2>AI 抠图</h2>
        <span>{{ selectionCount }} 个选区</span>
      </div>
      <p>原生推理 · 透明 PNG</p>
    </header>

    <div class="cutout-result-body">
      <CutoutResourceNotice
        v-if="resourceStatus !== 'checking' && resourceStatus !== 'ready'"
        :status="resourceStatus"
        :phase="phase"
        :progress="resourceProgress"
        :download-size-bytes="resourceDownloadSizeBytes"
        :local-models-supported="localModelsSupported"
        @install="emit('installResources')"
      />

      <section class="cutout-results-section" aria-label="抠图结果列表">
        <div class="cutout-results-heading">
          <h3>结果</h3>
          <span class="cutout-results-count">{{ results.length }}</span>
        </div>
        <p
          v-if="phase === 'processing' && progress"
          class="cutout-segment-progress"
          role="status"
        >
          <span>{{ processingLabel }} {{ progress.current }} / {{ progress.total }}</span>
          <span class="cutout-progress-bar" aria-hidden="true">
            <span :style="{ width: `${segmentPercent}%` }" />
          </span>
        </p>
        <ul v-if="results.length" class="cutout-result-list">
          <li v-for="result in results" :key="result.id" class="cutout-result-item">
            <div class="cutout-result-thumb">
              <img :src="result.thumbnailUrl" :alt="`抠图结果 ${result.width}×${result.height}`" />
            </div>
            <div class="cutout-result-info">
              <strong>{{ result.baseName }}</strong>
              <span>{{ result.width }} × {{ result.height }} px</span>
              <div class="cutout-result-actions">
                <button
                  class="cutout-mini-button"
                  type="button"
                  title="复制透明素材"
                  aria-label="复制透明素材"
                  :disabled="copyingId === result.id"
                  @click="emit('copyResult', result)"
                >
                  <LoaderCircle
                    v-if="copyingId === result.id"
                    class="cutout-spinner"
                    :size="14"
                    aria-hidden="true"
                  />
                  <Clipboard v-else :size="14" aria-hidden="true" />
                </button>
                <button
                  class="cutout-mini-button"
                  type="button"
                  title="保存透明素材"
                  aria-label="保存透明素材"
                  :disabled="savingId === result.id"
                  @click="emit('saveResult', result)"
                >
                  <LoaderCircle
                    v-if="savingId === result.id"
                    class="cutout-spinner"
                    :size="14"
                    aria-hidden="true"
                  />
                  <Download v-else :size="14" aria-hidden="true" />
                </button>
                <button
                  class="cutout-mini-button"
                  type="button"
                  title="移除结果"
                  aria-label="移除结果"
                  :disabled="isWorking"
                  @click="emit('removeResult', result.id)"
                >
                  <X :size="14" aria-hidden="true" />
                </button>
              </div>
            </div>
          </li>
        </ul>
        <div v-else-if="phase !== 'processing'" class="cutout-results-empty">
          <PackageOpen :size="26" aria-hidden="true" />
          <span>暂无结果</span>
        </div>
      </section>
    </div>

    <div class="cutout-result-footer">
      <p
        v-if="isLoggedIn && !isWorking"
        class="cutout-credits-info"
        :class="{ 'is-insufficient': insufficientCredits }"
      >
        <span>预计消耗 {{ cost }} 积分</span>
        <span class="cutout-credits-balance">余额 {{ balance }} 积分</span>
      </p>
      <p v-if="visibleError" class="cutout-result-error" role="alert">{{ visibleError }}</p>
      <div class="cutout-footer-actions" :class="{ 'has-cancel': isWorking }">
        <button
          v-if="isWorking"
          class="cutout-ghost-button"
          type="button"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          class="cutout-primary-button"
          :class="{ 'is-insufficient': isLoggedIn && insufficientCredits }"
          type="button"
          :disabled="segmentButtonDisabled"
          @click="emit('segment')"
        >
          <LoaderCircle
            v-if="phase === 'processing'"
            class="cutout-spinner"
            :size="16"
            aria-hidden="true"
          />
          <Sparkles v-else :size="16" aria-hidden="true" />
          {{ segmentButtonLabel }}
        </button>
        <button
          class="cutout-primary-button cutout-export-all"
          type="button"
          :disabled="!results.length || isWorking || exportingAll"
          @click="emit('exportAll')"
        >
          <LoaderCircle
            v-if="exportingAll"
            class="cutout-spinner"
            :size="16"
            aria-hidden="true"
          />
          <Check v-else :size="16" aria-hidden="true" />
          一键导出
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.cutout-result-panel {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border-left: 1px solid var(--line);
  background: var(--surface);
}

.cutout-result-body {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cutout-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);

  div {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  h2 {
    margin: 0;
    color: var(--text);
    font-size: 15px;
    font-weight: 660;
  }

  span,
  p {
    margin: 0;
    color: var(--muted);
    font-size: 10px;
    white-space: nowrap;
  }
}

.cutout-results-section {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  align-content: start;
  gap: 10px;
  overflow: hidden;
  padding: 14px 0 0;
}

.cutout-results-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;

  h3 {
    margin: 0;
    color: var(--text);
    font-size: 12px;
    font-weight: 660;
  }
}

.cutout-results-count {
  min-width: 18px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border-radius: 7px;
  color: var(--accent-strong);
  background: var(--accent-soft);
  font-size: 9px;
  font-weight: 700;
}

.cutout-segment-progress {
  margin: 0 16px;
  display: grid;
  gap: 6px;
  color: var(--soft);
  font-size: 11px;
  font-weight: 600;
}

.cutout-progress-bar {
  position: relative;
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--line);

  > span {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 2px;
    background: var(--accent);
    transition: width 160ms ease;
  }
}

.cutout-result-list {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 8px;
  margin: 0;
  padding: 0 16px 16px;
  overflow: auto;
  list-style: none;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.cutout-result-item {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--field);
}

.cutout-result-thumb {
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 5px;
  background-color: #17202a;
  background-image:
    linear-gradient(45deg, rgba(241, 244, 248, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(241, 244, 248, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(241, 244, 248, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(241, 244, 248, 0.08) 75%);
  background-position: 0 0, 0 7px, 7px -7px, -7px 0;
  background-size: 14px 14px;

  img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
}

.cutout-result-info {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 2px;

  strong {
    overflow: hidden;
    color: var(--text);
    font-size: 11px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > span {
    color: var(--muted);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
}

.cutout-result-actions {
  display: flex;
  gap: 5px;
  margin-top: 4px;
}

.cutout-mini-button {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--soft);
  background: var(--surface-subtle);

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: var(--accent-border);
    color: var(--accent-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.cutout-results-empty {
  min-height: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  padding: 28px 16px;
  color: var(--muted);
  font-size: 11px;

  svg {
    opacity: 0.5;
  }
}

.cutout-result-footer {
  display: grid;
  gap: 10px;
  padding: 14px 16px 18px;
  border-top: 1px solid var(--line);
  background: var(--surface);
}

.cutout-credits-info {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;

  &.is-insufficient {
    color: var(--danger);
  }
}

.cutout-credits-balance {
  color: var(--soft);
  font-weight: 500;
}

.is-insufficient .cutout-credits-balance {
  color: var(--danger);
}

.cutout-result-error {
  margin: 0;
  color: var(--danger);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.45;
}

.cutout-footer-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  &.has-cancel {
    grid-template-columns: auto repeat(2, minmax(0, 1fr));
  }
}

.cutout-ghost-button,
.cutout-primary-button {
  min-width: 0;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 650;
}

.cutout-ghost-button {
  border: 1px solid var(--line-strong);
  color: var(--soft);
  background: var(--surface-subtle);

  &:hover,
  &:focus-visible {
    border-color: var(--accent-border);
    color: var(--accent-strong);
  }
}

.cutout-primary-button {
  border: 0;
  color: #0a0f15;
  background: var(--accent);

  &:hover:not(:disabled),
  &:focus-visible {
    background: var(--accent-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  &.is-insufficient {
    border: 1px solid var(--accent-border);
    color: var(--accent-strong);
    background: var(--accent-soft);

    &:hover:not(:disabled),
    &:focus-visible {
      color: #0a0f15;
      background: var(--accent);
    }
  }
}

.cutout-export-all {
  border: 1px solid var(--accent-border);
  color: var(--accent-strong);
  background: var(--accent-soft);

  &:hover:not(:disabled),
  &:focus-visible {
    color: #0a0f15;
    background: var(--accent);
  }
}

.cutout-spinner {
  animation: spin 0.9s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .cutout-progress-bar > span {
    transition: none;
  }

  .cutout-spinner {
    animation: none;
  }
}
</style>
