<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from "vue";
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
  progress: CutoutProgress | null;
  error: string;
  copyingId: string | null;
  savingId: string | null;
  exportingAll: boolean;
  hasImage: boolean;
  selectionCount: number;
  hasBackgroundSelections: boolean;
  repairResourceStatus: CutoutResourceStatus;
  repairProgress: CutoutResourceProgress | null;
  localModelsSupported: boolean;
  cost: number;
  balance: number;
  isLoggedIn: boolean;
  insufficientCredits: boolean;
}>();

const emit = defineEmits<{
  installResources: [];
  installRepairResource: [];
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
    props.resourceStatus === "ready" &&
    (!props.hasBackgroundSelections || props.repairResourceStatus === "ready")
);
const segmentPercent = computed(() => {
  const progress = props.progress;
  if (!progress?.total) return 0;
  return Math.min(100, Math.round(progress.current / progress.total * 100));
});
const processingLabel = computed(() => ({
  segmenting: "正在分割",
  refining: "正在精修",
  repairing: "正在修复背景",
  uploading: "正在上传修复任务",
  waiting: "正在等待云端修复"
}[props.progress?.stage ?? "segmenting"]));
const processingButtonLabel = computed(() => ({
  segmenting: "分割中",
  refining: "精修中",
  repairing: "修复中",
  uploading: "上传中",
  waiting: "云端修复中"
}[props.progress?.stage ?? "segmenting"]));
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

interface ResultPreviewState {
  resultId: string;
  url: string;
  left: number;
  top: number;
  width: number;
  height: number;
  placement: "left" | "right";
  arrowTop: number;
  alt: string;
}

const resultPreview = shallowRef<ResultPreviewState | null>(null);
const resultImageUrls = shallowRef<Record<string, string>>({});
const resultPreviewId = "cutout-result-enlarged-preview";
const resultImageBlobs = new Map<string, Blob>();

function syncResultImageUrls() {
  const currentUrls = resultImageUrls.value;
  const nextUrls: Record<string, string> = {};
  const visibleIds = new Set<string>();
  for (const result of props.results) {
    visibleIds.add(result.id);
    const currentUrl = currentUrls[result.id];
    if (currentUrl && resultImageBlobs.get(result.id) === result.blob) {
      nextUrls[result.id] = currentUrl;
      continue;
    }
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    nextUrls[result.id] = URL.createObjectURL(result.blob);
    resultImageBlobs.set(result.id, result.blob);
  }
  for (const [resultId, url] of Object.entries(currentUrls)) {
    if (!visibleIds.has(resultId)) {
      URL.revokeObjectURL(url);
      resultImageBlobs.delete(resultId);
    }
  }
  resultImageUrls.value = nextUrls;
}

function clearResultImageUrls() {
  for (const url of Object.values(resultImageUrls.value)) URL.revokeObjectURL(url);
  resultImageUrls.value = {};
  resultImageBlobs.clear();
}

function closeResultPreview() {
  if (resultPreview.value) URL.revokeObjectURL(resultPreview.value.url);
  resultPreview.value = null;
}

function openResultPreview(result: CutoutResult, event: Event) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  const bounds = target.getBoundingClientRect();
  const viewportPadding = 12;
  const gap = 12;
  const maxWidth = Math.min(400, window.innerWidth - viewportPadding * 2);
  const maxHeight = Math.min(400, window.innerHeight - viewportPadding * 2);
  const minShortEdge = Math.min(160, maxWidth, maxHeight);
  const aspectRatio = Math.max(0.01, result.width / Math.max(1, result.height));
  const width = aspectRatio >= 1
    ? maxWidth
    : Math.max(minShortEdge, Math.min(maxWidth, Math.round(maxHeight * aspectRatio)));
  const height = aspectRatio >= 1
    ? Math.max(minShortEdge, Math.min(maxHeight, Math.round(maxWidth / aspectRatio)))
    : maxHeight;
  const canPlaceLeft = bounds.left - width - gap >= viewportPadding;
  const canPlaceRight = bounds.right + gap + width <= window.innerWidth - viewportPadding;
  const placement: ResultPreviewState["placement"] = canPlaceLeft || !canPlaceRight
    ? "left"
    : "right";
  let left = placement === "left" ? bounds.left - width - gap : bounds.right + gap;
  left = Math.min(Math.max(viewportPadding, left), window.innerWidth - width - viewportPadding);
  const centeredTop = bounds.top + bounds.height / 2 - height / 2;
  const top = Math.min(
    Math.max(viewportPadding, centeredTop),
    window.innerHeight - height - viewportPadding
  );
  const arrowTop = Math.min(
    height - 18,
    Math.max(18, bounds.top + bounds.height / 2 - top)
  );

  if (resultPreview.value?.resultId === result.id) {
    resultPreview.value = {
      ...resultPreview.value,
      left,
      top,
      width,
      height,
      placement,
      arrowTop
    };
    return;
  }
  closeResultPreview();
  resultPreview.value = {
    resultId: result.id,
    url: URL.createObjectURL(result.blob),
    left,
    top,
    width,
    height,
    placement,
    arrowTop,
    alt: `抠图结果放大预览 ${result.width}×${result.height}`
  };
}

function closePreviewIfInactive(event: Event) {
  const target = event.currentTarget;
  if (!(target instanceof HTMLElement)) return;
  window.requestAnimationFrame(() => {
    if (target.matches(":hover") || document.activeElement === target) return;
    closeResultPreview();
  });
}

watch(
  () => props.results.map((result) => result.id).join("|"),
  () => {
    closeResultPreview();
    syncResultImageUrls();
  },
  { immediate: true }
);

onMounted(() => window.addEventListener("resize", closeResultPreview));
onBeforeUnmount(() => {
  window.removeEventListener("resize", closeResultPreview);
  closeResultPreview();
  clearResultImageUrls();
});
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
        :local-models-supported="localModelsSupported"
        @install="emit('installResources')"
      />

      <CutoutResourceNotice
        v-if="hasBackgroundSelections &&
          repairResourceStatus !== 'checking' && repairResourceStatus !== 'ready'"
        :status="repairResourceStatus"
        :phase="phase"
        :progress="repairProgress"
        :local-models-supported="localModelsSupported"
        title="本地背景修复模型"
        description="按需安装，不影响普通抠图资源"
        install-label="下载模型"
        @install="emit('installRepairResource')"
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
        <ul v-if="results.length" class="cutout-result-list" @scroll="closeResultPreview">
          <li v-for="result in results" :key="result.id" class="cutout-result-item">
            <button
              class="cutout-result-thumb"
              type="button"
              :aria-label="`放大预览 ${result.baseName}`"
              :aria-describedby="resultPreview?.resultId === result.id ? resultPreviewId : undefined"
              @pointerenter="openResultPreview(result, $event)"
              @pointerleave="closePreviewIfInactive"
              @focus="openResultPreview(result, $event)"
              @blur="closePreviewIfInactive"
              @keydown.esc="closeResultPreview"
            >
              <img
                :src="resultImageUrls[result.id] ?? result.thumbnailUrl"
                :alt="`抠图结果 ${result.width}×${result.height}`"
              />
            </button>
            <div class="cutout-result-info">
              <div class="cutout-result-name">
                <strong>{{ result.baseName }}</strong>
                <span :class="`is-${result.kind}`">
                  {{ result.kind === 'background' ? '背景' : '素材' }}
                </span>
              </div>
              <span>{{ result.width }} × {{ result.height }} px</span>
              <div class="cutout-result-actions">
                <button
                  class="cutout-mini-button"
                  type="button"
                  :title="result.kind === 'background' ? '复制背景素材' : '复制透明素材'"
                  :aria-label="result.kind === 'background' ? '复制背景素材' : '复制透明素材'"
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
                  :title="result.kind === 'background' ? '保存背景素材' : '保存透明素材'"
                  :aria-label="result.kind === 'background' ? '保存背景素材' : '保存透明素材'"
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

    <Teleport to="body">
      <div
        v-if="resultPreview"
        :id="resultPreviewId"
        class="cutout-result-preview"
        :class="`is-${resultPreview.placement}`"
        role="tooltip"
        :style="{
          left: `${resultPreview.left}px`,
          top: `${resultPreview.top}px`,
          width: `${resultPreview.width}px`,
          height: `${resultPreview.height}px`
        }"
      >
        <span
          class="cutout-result-preview-arrow"
          :style="{ top: `${resultPreview.arrowTop}px` }"
          aria-hidden="true"
        />
        <img :src="resultPreview.url" :alt="resultPreview.alt" />
      </div>
    </Teleport>
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
  position: relative;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 0;
  border: 1px solid transparent;
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
    position: absolute;
    inset: 2px;
    width: calc(100% - 4px);
    height: calc(100% - 4px);
    display: block;
    object-fit: contain;
  }

  &:hover,
  &:focus-visible {
    border-color: var(--accent-border);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
}

.cutout-result-preview {
  position: fixed;
  z-index: 45;
  display: grid;
  place-items: center;
  overflow: visible;
  padding: 10px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background-color: #17202a;
  background-image:
    linear-gradient(45deg, rgba(241, 244, 248, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(241, 244, 248, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(241, 244, 248, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(241, 244, 248, 0.08) 75%);
  background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  background-size: 20px 20px;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.42);
  pointer-events: none;

  img {
    position: absolute;
    inset: 10px;
    width: calc(100% - 20px);
    height: calc(100% - 20px);
    display: block;
    object-fit: contain;
  }
}

.cutout-result-preview-arrow {
  position: absolute;
  z-index: 1;
  width: 14px;
  height: 14px;
  background: #17202a;
  transform: translateY(-50%) rotate(45deg);
}

.cutout-result-preview.is-left .cutout-result-preview-arrow {
  right: -8px;
  border-top: 1px solid var(--line-strong);
  border-right: 1px solid var(--line-strong);
}

.cutout-result-preview.is-right .cutout-result-preview-arrow {
  left: -8px;
  border-bottom: 1px solid var(--line-strong);
  border-left: 1px solid var(--line-strong);
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

.cutout-result-name {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;

  strong {
    min-width: 0;
    flex: 1;
  }

  span {
    flex: 0 0 auto;
    padding: 2px 4px;
    border: 1px solid var(--accent-border);
    border-radius: 4px;
    color: var(--accent-strong);
    background: var(--accent-soft);
    font-size: 8px;
    font-weight: 700;
    line-height: 1;

    &.is-background {
      border-color: color-mix(in srgb, var(--warm) 45%, transparent);
      color: var(--warm);
      background: color-mix(in srgb, var(--warm) 12%, transparent);
    }
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
