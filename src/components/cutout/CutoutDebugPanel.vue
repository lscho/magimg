<script setup lang="ts">
import { computed, shallowRef, type DeepReadonly } from "vue";
import { Bug, ChevronRight, ImagePlus, Play, Square, RotateCcw, LoaderCircle } from "lucide-vue-next";
import { formatDuration } from "@/services/cutoutDebugPreview";
import type { CutoutSelection } from "@/types";
import type {
  CutoutDebugStage,
  CutoutDebugSegmenter,
  CutoutDebugRepairMode,
  CutoutDebugResourceState
} from "@/composables/useCutoutDebugPipeline";

const props = withDefaults(
  defineProps<{
    stages: DeepReadonly<CutoutDebugStage[]>;
    running: boolean;
    error: string;
    totalDuration: number;
    resources: CutoutDebugResourceState;
    /** 默认分割档位，未单独指定的选区沿用。 */
    segmenter: CutoutDebugSegmenter;
    /** 逐选区模型覆盖：key 为选区 id。 */
    segmenterBySelection: Record<string, CutoutDebugSegmenter>;
    repairMode: CutoutDebugRepairMode;
    localModelsSupported: boolean;
    /** 当前画布上的选区（用于逐选区指派模型）。 */
    selections: CutoutSelection[];
  }>(),
  {}
);

const emit = defineEmits<{
  "update:segmenter": [value: CutoutDebugSegmenter];
  "update:segmenterBySelection": [value: Record<string, CutoutDebugSegmenter>];
  "update:repairMode": [value: CutoutDebugRepairMode];
  run: [];
  cancel: [];
  reset: [];
  import: [];
}>();

const segmenterOptions: { value: CutoutDebugSegmenter; label: string }[] = [
  { value: "birefnet", label: "BiRefNet" },
  { value: "sam", label: "SAM 2.1" }
];
const repairOptions: { value: CutoutDebugRepairMode; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "diffusion", label: "强制扩散" },
  { value: "model", label: "强制 Big-LaMa" }
];

const resourceItems = computed(() => [
  { key: "birefnet", label: "BiRefNet", status: props.resources.birefnet },
  { key: "sam", label: "SAM 2.1", status: props.resources.sam },
  { key: "refiner", label: "ViTMatte", status: props.resources.refiner },
  { key: "repair", label: "Big-LaMa", status: props.resources.repair }
]);

function statusTone(status: string) {
  if (status === "ready") return "ok";
  if (status === "downloading") return "busy";
  if (status === "error" || status === "missing" || status === "unsupported") return "bad";
  return "idle";
}

function statusText(status: string) {
  return (
    {
      ready: "就绪",
      downloading: "下载中",
      missing: "缺失",
      error: "错误",
      unsupported: "不支持",
      checking: "检查中"
    } as Record<string, string>
  )[status] ?? status;
}

const activeArtifact = shallowRef<{ url: string; label: string } | null>(null);
function openArtifact(artifact: { url: string; label: string }) {
  activeArtifact.value = artifact;
}
function closeArtifact() {
  activeArtifact.value = null;
}

const expandedIds = shallowRef<Set<string>>(new Set());
function toggleStage(id: string) {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
}
const isStageExpanded = (id: string) => expandedIds.value.has(id);

function setSegmenter(value: CutoutDebugSegmenter) {
  if (props.running) return;
  emit("update:segmenter", value);
}
function setRepair(value: CutoutDebugRepairMode) {
  if (props.running) return;
  emit("update:repairMode", value);
}

function effectiveSelectionModel(id: string): CutoutDebugSegmenter {
  return props.segmenterBySelection[id] ?? props.segmenter;
}
function setSelectionModel(id: string, model: CutoutDebugSegmenter) {
  if (props.running) return;
  emit("update:segmenterBySelection", { ...props.segmenterBySelection, [id]: model });
}
function selectionName(sel: CutoutSelection, index: number) {
  const shape = sel.polygon?.length ? "多边形" : "矩形";
  const behavior = sel.behavior === "background" ? "背景" : "素材";
  return `选区 ${index + 1}（${shape}・${behavior}）`;
}
const hasMixedSegmenter = computed(() => {
  const models = props.selections.map((sel) => effectiveSelectionModel(sel.id));
  return new Set(models).size > 1;
});
</script>

<template>
  <aside class="debug-panel" aria-label="抠图调试台">
    <header class="debug-panel-header">
      <div class="debug-title">
        <Bug :size="16" aria-hidden="true" />
        <strong>抠图调试台</strong>
      </div>
      <p class="debug-subtitle">
        仅开发模式 · 不扣积分 · 不写历史 · 不调用云端
      </p>
    </header>

    <section class="debug-resources" aria-label="模型资源状态">
      <span
        v-for="item in resourceItems"
        :key="item.key"
        class="resource-chip"
        :class="`tone-${statusTone(item.status)}`"
      >
        <span class="resource-label">{{ item.label }}</span>
        <span class="resource-status">{{ statusText(item.status) }}</span>
      </span>
    </section>

    <section class="debug-controls" aria-label="调试参数">
      <div class="control-row">
        <span class="control-label">默认模型</span>
        <div class="segmented">
          <button
            v-for="option in segmenterOptions"
            :key="option.value"
            type="button"
            class="segmented-item"
            :class="{ active: segmenter === option.value }"
            :disabled="running"
            @click="setSegmenter(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
      <p class="control-caption">未单独指定的选区沿用此默认模型；下方可逐选区覆盖。</p>
      <div class="control-row">
        <span class="control-label">修复分流</span>
        <div class="segmented">
          <button
            v-for="option in repairOptions"
            :key="option.value"
            type="button"
            class="segmented-item"
            :class="{ active: repairMode === option.value }"
            :disabled="running"
            @click="setRepair(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-if="selections.length" class="control-row control-row-stack">
        <span class="control-label">逐选区模型</span>
        <ul class="selection-list">
          <li v-for="(sel, idx) in selections" :key="sel.id" class="selection-row">
            <span class="selection-name">{{ selectionName(sel, idx) }}</span>
            <div class="segmented segmented-mini">
              <button
                v-for="option in segmenterOptions"
                :key="option.value"
                type="button"
                class="segmented-item"
                :class="{ active: effectiveSelectionModel(sel.id) === option.value }"
                :disabled="running"
                @click="setSelectionModel(sel.id, option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </li>
        </ul>
      </div>
      <p v-if="hasMixedSegmenter" class="debug-hint">
        已为部分选区指定不同模型，将一次性用各自模型推理，并在末尾合并导出单张透明 PNG。
      </p>
      <div class="control-actions">
        <button type="button" class="ghost-button" :disabled="running" @click="emit('import')">
          <ImagePlus :size="15" aria-hidden="true" />
          <span>导入图片</span>
        </button>
        <button
          type="button"
          class="primary-button"
          :disabled="running"
          @click="emit('run')"
        >
          <Play :size="15" aria-hidden="true" />
          <span>运行流水线</span>
        </button>
        <button
          v-if="running"
          type="button"
          class="danger-button"
          @click="emit('cancel')"
        >
          <Square :size="14" aria-hidden="true" />
          <span>取消</span>
        </button>
        <button
          v-else
          type="button"
          class="ghost-button"
          :disabled="!stages.length"
          @click="emit('reset')"
        >
          <RotateCcw :size="14" aria-hidden="true" />
          <span>重置</span>
        </button>
      </div>
    </section>

    <p v-if="!localModelsSupported" class="debug-hint">
      当前为浏览器预览，无法运行本地模型。请在桌面客户端中打开调试页。
    </p>
    <p v-else-if="resources.birefnet === 'missing' || resources.sam === 'missing' || resources.refiner === 'missing'" class="debug-hint">
      分割或精修模型缺失，请先在「AI 抠图」页下载资源包。
    </p>

    <p v-if="error" class="debug-error" role="alert">{{ error }}</p>

    <section class="debug-stages" aria-label="处理环节">
      <p v-if="!stages.length && !running" class="debug-empty">
        导入图片并在画布上框选元素后，点击「运行流水线」查看每个环节的中间结果。
      </p>

      <article
        v-for="(stage, index) in stages"
        :key="stage.id"
        class="stage-card"
        :class="[`stage-${stage.status}`, { 'is-collapsed': !isStageExpanded(stage.id), 'is-expanded': isStageExpanded(stage.id) }]"
      >
        <button
          type="button"
          class="stage-head"
          :aria-expanded="isStageExpanded(stage.id)"
          @click="toggleStage(stage.id)"
        >
          <ChevronRight :size="14" class="stage-chevron" aria-hidden="true" />
          <span class="stage-index">{{ index + 1 }}</span>
          <div class="stage-heading">
            <strong class="stage-title">{{ stage.title }}</strong>
            <span v-if="stage.scope" class="stage-scope">{{ stage.scope }}</span>
          </div>
          <span class="stage-status" :class="`tone-${stage.status}`">
            <LoaderCircle v-if="stage.status === 'running'" :size="13" class="spin" aria-hidden="true" />
            <template v-else>{{ { running: "进行中", done: "完成", skipped: "跳过", error: "失败" }[stage.status] }}</template>
          </span>
        </button>

        <div v-if="isStageExpanded(stage.id)" class="stage-body">
          <p class="stage-summary">{{ stage.summary }}</p>

          <dl v-if="stage.metrics.length" class="stage-metrics">
            <div v-for="metric in stage.metrics" :key="metric.label" class="metric">
              <dt>{{ metric.label }}</dt>
              <dd>{{ metric.value }}</dd>
            </div>
          </dl>

          <div v-if="stage.artifacts.length" class="stage-artifacts">
            <button
              v-for="artifact in stage.artifacts"
              :key="artifact.id"
              type="button"
              class="artifact"
              :title="artifact.note ? `${artifact.label} — ${artifact.note}` : artifact.label"
              @click="openArtifact(artifact)"
            >
              <img :src="artifact.url" :alt="artifact.label" loading="lazy" />
              <span class="artifact-label">{{ artifact.label }}</span>
              <span v-if="artifact.note" class="artifact-note">{{ artifact.note }}</span>
            </button>
          </div>

          <p v-if="stage.error" class="stage-error">{{ stage.error }}</p>
        </div>
      </article>

      <p v-if="!running && totalDuration > 0" class="debug-total">
        总耗时 {{ formatDuration(totalDuration) }}
      </p>
    </section>

    <div v-if="activeArtifact" class="artifact-lightbox" @click="closeArtifact">
      <figure class="artifact-lightbox-inner" @click.stop>
        <img :src="activeArtifact.url" :alt="activeArtifact.label" />
        <figcaption>{{ activeArtifact.label }}</figcaption>
        <button type="button" class="artifact-lightbox-close" @click="closeArtifact">关闭</button>
      </figure>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.debug-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--line);
  background: var(--surface);
}

.debug-panel-header {
  flex: 0 0 auto;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--line);
}

.debug-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);

  strong {
    font-size: 14px;
    font-weight: 680;
  }
}

.debug-subtitle {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
}

.debug-resources {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
}

.resource-chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface-subtle);

  .resource-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
  }

  .resource-status {
    font-size: 10px;
    font-weight: 600;
    color: var(--muted);
  }

  &.tone-ok {
    border-color: rgba(101, 211, 173, 0.42);
    background: rgba(101, 211, 173, 0.10);

    .resource-status { color: var(--success); }
  }

  &.tone-busy {
    border-color: var(--accent-border);
    background: var(--accent-soft);

    .resource-status { color: var(--accent-strong); }
  }

  &.tone-bad {
    border-color: rgba(239, 125, 136, 0.4);
    background: rgba(239, 125, 136, 0.10);

    .resource-status { color: var(--danger); }
  }
}

.debug-controls {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
}

.control-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.control-label {
  flex: 0 0 56px;
  font-size: 12px;
  font-weight: 600;
  color: var(--soft);
}

.control-caption {
  margin: -6px 0 0;
  padding: 0 2px;
  color: var(--muted);
  font-size: 10.5px;
  line-height: 1.5;
}

.control-row-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;

  .control-label {
    flex: none;
  }
}

.selection-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.selection-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.selection-name {
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.segmented-mini {
  flex: 0 0 auto;
  width: 168px;

  .segmented-item {
    padding: 5px 6px;
    font-size: 11px;
  }
}

.segmented {
  display: flex;
  flex: 1;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-subtle);
}

.segmented-item {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  color: var(--muted);
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease;

  &:hover:not(:disabled):not(.active) {
    color: var(--text);
  }

  &.active {
    color: var(--accent-strong);
    background: var(--accent-soft);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
}

.control-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
}

.primary-button,
.ghost-button,
.danger-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    background 0.16s ease,
    color 0.16s ease;
}

.primary-button {
  border: 1px solid var(--accent-border);
  color: var(--accent-strong);
  background: var(--accent-soft);

  &:hover:not(:disabled) {
    background: var(--accent);
    color: #0c1018;
  }
}

.ghost-button {
  border: 1px solid var(--line);
  color: var(--soft);
  background: var(--surface-subtle);

  &:hover:not(:disabled) {
    border-color: var(--line-strong);
    color: var(--text);
  }
}

.danger-button {
  border: 1px solid rgba(239, 125, 136, 0.4);
  color: var(--danger);
  background: rgba(239, 125, 136, 0.10);

  &:hover {
    background: rgba(239, 125, 136, 0.18);
  }
}

.primary-button:disabled,
.ghost-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.debug-hint {
  margin: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  color: var(--warm);
  background: rgba(228, 160, 107, 0.08);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
}

.debug-error {
  margin: 0;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  color: var(--danger);
  background: rgba(239, 125, 136, 0.08);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
}

.debug-stages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 12px 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.debug-empty {
  margin: 8px 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.stage-card {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface-subtle);
  overflow: hidden;

  &.stage-error {
    border-color: rgba(239, 125, 136, 0.42);
  }

  &.stage-skipped {
    opacity: 0.72;
  }
}

.stage-head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid var(--line);
  background: transparent;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color 0.16s ease;

  &:hover {
    background: var(--surface-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
}

.stage-card.is-collapsed .stage-head {
  border-bottom: none;
}

.stage-chevron {
  flex: 0 0 auto;
  color: var(--muted);
  transition: transform 0.18s ease;
}

.stage-card.is-expanded .stage-chevron {
  transform: rotate(90deg);
}

.stage-body {
  padding-top: 2px;
}

.stage-index {
  flex: 0 0 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--muted);
  background: var(--surface-strong);
  font-size: 12px;
  font-weight: 700;
}

.stage-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stage-title {
  font-size: 12.5px;
  font-weight: 680;
  color: var(--text);
}

.stage-scope {
  font-size: 10.5px;
  color: var(--muted);
}

.stage-status {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 700;

  &.tone-done { color: var(--success); }
  &.tone-error { color: var(--danger); }
  &.tone-skipped { color: var(--muted); }
  &.tone-running { color: var(--accent-strong); }
}

.stage-summary {
  margin: 0;
  padding: 10px 12px 0;
  color: var(--soft);
  font-size: 11.5px;
  line-height: 1.6;
}

.stage-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 10px 12px 0;
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 1px;

  dt {
    font-size: 10px;
    color: var(--muted);
  }

  dd {
    margin: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
}

.stage-artifacts {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 10px 12px 12px;
}

.artifact {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  cursor: zoom-in;
  transition: border-color 0.16s ease;

  &:hover {
    border-color: var(--accent-border);
  }

  img {
    width: 100%;
    height: auto;
    display: block;
    border-radius: 5px;
    background:
      linear-gradient(45deg, #1b2330 25%, transparent 25%) 0 0 / 12px 12px,
      linear-gradient(-45deg, #1b2330 25%, transparent 25%) 0 0 / 12px 12px,
      linear-gradient(45deg, transparent 75%, #1b2330 75%) 0 0 / 12px 12px,
      linear-gradient(-45deg, transparent 75%, #1b2330 75%) 0 0 / 12px 12px,
      #141b24;
  }
}

.artifact-label {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--soft);
  line-height: 1.3;
}

.artifact-note {
  font-size: 9.5px;
  color: var(--muted);
  line-height: 1.3;
}

.stage-error {
  margin: 0;
  padding: 0 12px 12px;
  color: var(--danger);
  font-size: 11px;
  font-weight: 600;
}

.debug-total {
  margin: 4px 0 0;
  text-align: center;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

.artifact-lightbox {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 32px;
  background: rgba(5, 8, 12, 0.78);
  -webkit-backdrop-filter: blur(4px);
  backdrop-filter: blur(4px);
}

.artifact-lightbox-inner {
  position: relative;
  max-width: min(92vw, 1100px);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;

  img {
    max-width: 100%;
    max-height: 78vh;
    border-radius: 10px;
    border: 1px solid var(--line-strong);
    background: #141b24;
  }

  figcaption {
    text-align: center;
    color: var(--soft);
    font-size: 12px;
    font-weight: 600;
  }
}

.artifact-lightbox-close {
  position: absolute;
  top: -14px;
  right: -14px;
  padding: 6px 12px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  color: var(--text);
  background: var(--surface-raised);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.spin {
  animation: debug-spin 0.9s linear infinite;
}

@keyframes debug-spin {
  to { transform: rotate(360deg); }
}
</style>
