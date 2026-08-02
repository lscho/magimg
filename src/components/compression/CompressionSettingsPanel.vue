<script setup lang="ts">
import { computed } from "vue";
import {
  Ban,
  CircleAlert,
  CircleCheck,
  CircleX,
  FileCheck2,
  FolderOpen,
  LoaderCircle,
  Play,
  Settings2,
  Square
} from "lucide-vue-next";
import type { CompressionWorkspaceItem } from "@/composables/useImageCompression";
import type { CompressionSummary } from "@/types";

const props = withDefaults(defineProps<{
  items?: CompressionWorkspaceItem[];
  rejectedCount?: number;
  outputDirectory?: string;
  canStart?: boolean;
  running?: boolean;
  cancelling?: boolean;
  currentItem?: string;
  progressPercent?: number;
  completedCount?: number;
  progressTotal?: number;
  summary?: CompressionSummary | null;
}>(), {
  items: () => [],
  rejectedCount: 0,
  outputDirectory: "",
  canStart: false,
  running: false,
  cancelling: false,
  currentItem: "",
  progressPercent: 0,
  completedCount: 0,
  progressTotal: 0,
  summary: null
});

const emit = defineEmits<{
  openSettings: [];
  selectOutput: [];
  start: [];
  cancel: [];
}>();

const resultItems = computed(() =>
  props.items.filter((item) => item.status !== "pending" && item.status !== "processing")
);

const statusLabels = {
  pending: "待处理",
  processing: "压缩中",
  succeeded: "已完成",
  noBenefit: "无收益",
  skipped: "已跳过",
  failed: "失败",
  cancelled: "已取消"
} as const;

function formatBytes(bytes: number | null) {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatSaved(value: number | null) {
  if (value === null) return "";
  return value >= 0 ? `节省 ${value.toFixed(1)}%` : `增大 ${Math.abs(value).toFixed(1)}%`;
}

function resultPath(item: CompressionWorkspaceItem) {
  return item.outputRelativePath || item.relativePath;
}
</script>

<template>
  <aside class="compression-results" aria-label="压缩结果">
    <div class="results-scroll">
      <section class="output-section">
        <div class="section-heading">
          <h2>输出</h2>
          <button
            class="settings-button"
            type="button"
            :disabled="running"
            aria-label="打开压缩设置"
            @click="emit('openSettings')"
          >
            <Settings2 :size="15" aria-hidden="true" />
            设置
          </button>
        </div>
        <label class="field-label">输出文件夹</label>
        <button class="directory-button" type="button" :disabled="running" @click="emit('selectOutput')">
          <FolderOpen :size="15" aria-hidden="true" />
          <span :title="outputDirectory">{{ outputDirectory || "选择输出文件夹" }}</span>
        </button>
      </section>

      <section class="result-section" aria-labelledby="compression-results-title">
        <div class="section-heading result-heading">
          <h2 id="compression-results-title">压缩结果</h2>
          <span v-if="summary">{{ summary.succeeded }}/{{ summary.total }}</span>
        </div>

        <div v-if="resultItems.length" class="result-list">
          <article
            v-for="item in resultItems"
            :key="item.id"
            class="result-item"
            :data-status="item.status"
          >
            <CircleCheck v-if="item.status === 'succeeded'" :size="16" aria-hidden="true" />
            <CircleX v-else-if="item.status === 'failed'" :size="16" aria-hidden="true" />
            <Ban v-else-if="item.status === 'cancelled'" :size="16" aria-hidden="true" />
            <CircleAlert v-else :size="16" aria-hidden="true" />
            <div class="result-copy">
              <div class="result-title">
                <strong :title="resultPath(item)">{{ resultPath(item).split('/').pop() }}</strong>
                <span>{{ statusLabels[item.status] }}</span>
              </div>
              <small v-if="item.status === 'succeeded'">
                {{ formatBytes(item.outputSize) }}<template v-if="item.savedPercent !== null"> · {{ formatSaved(item.savedPercent) }}</template>
              </small>
              <small v-else>{{ item.message || resultPath(item) }}</small>
            </div>
          </article>
        </div>

        <div v-else class="result-empty">
          <FileCheck2 :size="24" aria-hidden="true" />
          <strong>{{ running ? "等待首个结果" : "暂无压缩结果" }}</strong>
          <span v-if="rejectedCount">已忽略 {{ rejectedCount }} 项</span>
        </div>
      </section>

      <section v-if="summary" class="summary-section" aria-label="压缩汇总">
        <div><span>完成</span><strong>{{ summary.succeeded }}</strong></div>
        <div><span>无收益</span><strong>{{ summary.noBenefit }}</strong></div>
        <div><span>跳过</span><strong>{{ summary.skipped }}</strong></div>
        <div><span>失败</span><strong :class="{ danger: summary.failed }">{{ summary.failed }}</strong></div>
        <p>共节省 {{ formatBytes(summary.savedBytes) }}</p>
      </section>
    </div>

    <footer class="results-footer">
      <div v-if="running" class="progress-block" aria-live="polite">
        <div class="progress-copy">
          <span :title="currentItem">{{ cancelling ? "正在停止" : currentItem || "准备压缩" }}</span>
          <strong>{{ completedCount }}/{{ progressTotal }}</strong>
        </div>
        <div class="progress-track" role="progressbar" :aria-valuenow="progressPercent" aria-valuemin="0" aria-valuemax="100">
          <span :style="{ width: `${progressPercent}%` }" />
        </div>
      </div>
      <button v-if="running" class="cancel-button" type="button" :disabled="cancelling" @click="emit('cancel')">
        <LoaderCircle v-if="cancelling" class="spin" :size="16" aria-hidden="true" />
        <Square v-else :size="15" aria-hidden="true" />
        {{ cancelling ? "正在停止" : "停止压缩" }}
      </button>
      <button v-else class="primary-button" type="button" :disabled="!canStart" @click="emit('start')">
        <Play :size="16" aria-hidden="true" />
        开始压缩
      </button>
    </footer>
  </aside>
</template>

<style scoped lang="scss">
.compression-results {
  width: 340px;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  border-left: 1px solid var(--line);
  background: var(--surface);
}

.results-scroll {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(220px, 1fr) auto;
  overflow: hidden;
}

.output-section,
.result-section,
.summary-section {
  padding: 16px 18px;
  border-bottom: 1px solid var(--line);
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;

  h2 {
    margin: 0;
    color: var(--text);
    font-size: 12px;
    font-weight: 680;
  }
}

.settings-button {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--soft);
  background: var(--field);
  font-size: 10px;
  font-weight: 620;

  &:hover:not(:disabled) { border-color: var(--line-strong); background: var(--surface-strong); }
}

.field-label {
  display: block;
  margin-bottom: 7px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
}

.directory-button {
  width: 100%;
  min-width: 0;
  height: 42px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--soft);
  background: var(--field);

  &:hover:not(:disabled) { border-color: var(--line-strong); }
  svg { flex: 0 0 auto; }
  span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}

.result-section {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  padding-right: 0;
  padding-left: 0;
}

.result-heading {
  padding: 0 18px;

  > span { color: var(--muted); font-size: 10px; font-variant-numeric: tabular-nums; }
}

.result-list {
  min-height: 0;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.result-item {
  min-height: 58px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: start;
  gap: 9px;
  padding: 10px 18px;
  border-top: 1px solid var(--line);
  color: var(--muted);

  &[data-status="succeeded"] > svg { color: var(--success); }
  &[data-status="failed"] > svg { color: var(--danger); }
  &[data-status="noBenefit"] > svg { color: var(--warm); }

  > svg { margin-top: 1px; }
}

.result-copy { min-width: 0; display: grid; gap: 4px; }
.result-title {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;

  strong { overflow: hidden; color: var(--soft); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  span { flex: 0 0 auto; color: var(--muted); font-size: 9px; }
}

.result-copy small {
  overflow: hidden;
  color: var(--muted);
  font-size: 9px;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-item[data-status="failed"] .result-copy small { color: var(--danger); white-space: normal; }

.result-empty {
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--muted);

  strong { color: var(--soft); font-size: 11px; }
  span { font-size: 9px; }
}

.summary-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px 18px;
  font-size: 10px;

  div { display: flex; justify-content: space-between; color: var(--muted); }
  strong { color: var(--soft); font-variant-numeric: tabular-nums; }
  .danger { color: var(--danger); }
  p { grid-column: 1 / -1; margin: 3px 0 0; color: var(--success); }
}

.results-footer {
  display: grid;
  gap: 12px;
  padding: 14px 18px 18px;
  border-top: 1px solid var(--line);
  background: #0d131a;
}

.progress-block { display: grid; gap: 8px; }
.progress-copy {
  min-width: 0;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-size: 10px;

  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  strong { flex: 0 0 auto; color: var(--soft); font-variant-numeric: tabular-nums; }
}

.progress-track {
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--line);

  span { height: 100%; display: block; background: var(--accent); transition: width 180ms ease; }
}

.cancel-button {
  width: 100%;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid rgba(239, 125, 136, 0.42);
  border-radius: 7px;
  color: var(--danger);
  background: rgba(239, 125, 136, 0.09);
  font-size: 12px;
  font-weight: 650;
}

.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  .compression-results {
    width: 100%;
    min-height: 560px;
    border-top: 1px solid var(--line);
    border-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress-track span { transition: none; }
  .spin { animation-duration: 1.8s; }
}
</style>
