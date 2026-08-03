<script setup lang="ts">
import {
  Download,
  History,
  Layers3,
  LoaderCircle,
  Package,
  PanelRightClose,
  PanelRightOpen,
  Save,
  X
} from "lucide-vue-next";
import { computed } from "vue";
import type { CutoutProgress, CutoutResourceStatus } from "@/composables/useCutoutInference";

const props = defineProps<{
  stage: "idle" | "local" | "uploading" | "waiting" | "complete" | "draft";
  progress: CutoutProgress | null;
  resourceStatus: CutoutResourceStatus;
  recognitionResourceStatus: CutoutResourceStatus;
  recognitionResourceProgress: number;
  drawerOpen: boolean;
  hasDocument: boolean;
  canOpenDrawer: boolean;
  hasSelections: boolean;
  canPackage: boolean;
  canSaveSelections: boolean;
  canOpenSelectionHistory: boolean;
  selectionHistoryLoading: boolean;
  canRun: boolean;
  cost: number;
  balance: number;
  error: string;
}>();

const emit = defineEmits<{
  installResources: [];
  savePackage: [];
  saveSelections: [];
  openSelectionHistory: [];
  toggleDrawer: [];
  run: [];
  retryCloud: [];
  cancel: [];
}>();

const busy = computed(() => ["local", "uploading", "waiting"].includes(props.stage));
const recognitionDownloading = computed(() => props.recognitionResourceStatus === "downloading");
const stageLabel = computed(() => {
  if (props.stage === "local") {
    return ({ segmenting: "识别元素", refining: "精修与 OCR", repairing: "清理父层", uploading: "上传", waiting: "等待" } as const)
      [props.progress?.stage ?? "segmenting"];
  }
  if (props.stage === "idle") return props.hasSelections ? "准备分层" : "等待框选";
  return ({ uploading: "上传背景蒙版", waiting: "云端生成背景", complete: "分层完成", draft: "本地草稿" } as const)
    [props.stage as "uploading" | "waiting" | "complete" | "draft"];
});
const coreResourcesReady = computed(() => props.resourceStatus === "ready");
const runDisabled = computed(() => !props.canRun || !coreResourcesReady.value
  || props.recognitionResourceStatus === "checking" || recognitionDownloading.value);
const runLabel = computed(() => {
  if (recognitionDownloading.value) return `下载资源 ${props.recognitionResourceProgress}%`;
  return props.hasDocument ? "重新分层" : "一键分层";
});
const recognitionProgressStyle = computed(() => ({ width: `${props.recognitionResourceProgress}%` }));
</script>

<template>
  <footer class="auto-layer-action-bar" aria-label="自动分层操作">
    <div class="auto-layer-status">
      <span class="status-dot" :class="{ active: busy, complete: stage === 'complete', warning: stage === 'draft' }" />
      <strong>{{ stageLabel }}</strong>
      <span v-if="progress && stage === 'local'">{{ progress.current }}/{{ progress.total }}</span>
      <span>{{ cost }} 积分</span>
      <span>余额 {{ balance }}</span>
      <button
        v-if="resourceStatus !== 'ready'"
        type="button"
        :disabled="busy"
        @click="emit('installResources')"
      >
        <Download :size="13" aria-hidden="true" /> 抠图资源
      </button>
      <span v-if="error" class="status-error" role="alert">{{ error }}</span>
    </div>
    <div class="auto-layer-actions">
      <button type="button" :disabled="!canSaveSelections" @click="emit('saveSelections')">
        <Save :size="15" aria-hidden="true" /> 保存选区
      </button>
      <button
        type="button"
        :disabled="!canOpenSelectionHistory || selectionHistoryLoading"
        :aria-busy="selectionHistoryLoading"
        @click="emit('openSelectionHistory')"
      >
        <LoaderCircle v-if="selectionHistoryLoading" class="run-spinner" :size="15" aria-hidden="true" />
        <History v-else :size="15" aria-hidden="true" />
        选区记录
      </button>
      <button type="button" :disabled="!canPackage || busy" @click="emit('savePackage')">
        <Package :size="15" aria-hidden="true" /> 打包保存
      </button>
      <button type="button" :disabled="!canOpenDrawer" @click="emit('toggleDrawer')">
        <PanelRightClose v-if="drawerOpen" :size="15" aria-hidden="true" />
        <PanelRightOpen v-else :size="15" aria-hidden="true" />
        {{ drawerOpen ? '收起结果' : '展开结果' }}
      </button>
      <button v-if="busy" class="danger" type="button" @click="emit('cancel')">
        <X :size="15" aria-hidden="true" /> 取消
      </button>
      <button v-else-if="stage === 'draft' && hasDocument" class="primary" type="button" @click="emit('retryCloud')">
        <Layers3 :size="15" aria-hidden="true" /> 重试云背景
      </button>
      <button
        v-else
        class="primary run-button"
        type="button"
        :disabled="runDisabled"
        :aria-busy="recognitionDownloading"
        @click="emit('run')"
      >
        <span
          v-if="recognitionDownloading"
          class="run-progress"
          :style="recognitionProgressStyle"
          aria-hidden="true"
        />
        <span class="run-content" aria-live="polite">
          <LoaderCircle v-if="recognitionDownloading" class="run-spinner" :size="15" aria-hidden="true" />
          <Layers3 v-else :size="15" aria-hidden="true" />
          {{ runLabel }}
        </span>
      </button>
    </div>
  </footer>
</template>

<style scoped lang="scss">
.auto-layer-action-bar {
  min-width: 0;
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
  background: var(--surface-raised);
}
.auto-layer-status,
.auto-layer-actions { min-width: 0; display: flex; align-items: center; gap: 8px; }
.auto-layer-status { overflow: hidden; color: var(--muted); font-size: 10px; }
.auto-layer-status strong { color: var(--text); font-size: 11px; white-space: nowrap; }
.status-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--muted); }
.status-dot.active { background: var(--accent); animation: status-pulse 1.2s ease-in-out infinite; }
.status-dot.complete { background: var(--success); }
.status-dot.warning { background: var(--warning); }
.status-error { max-width: 300px; overflow: hidden; color: var(--danger); text-overflow: ellipsis; white-space: nowrap; }
button {
  min-height: 34px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 0 10px; border: 1px solid var(--line); border-radius: 6px;
  color: var(--text); background: var(--field); font-size: 11px; white-space: nowrap;
}
button:hover:not(:disabled) { border-color: var(--line-strong); background: var(--surface-subtle); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button:disabled { opacity: 0.42; cursor: not-allowed; }
button.primary { color: var(--accent-contrast); border-color: var(--accent); background: var(--accent); font-weight: 700; }
button.danger { color: var(--danger); }
.run-button { position: relative; min-width: 104px; overflow: hidden; }
.run-button:disabled[aria-busy="true"] { opacity: 1; }
.run-progress { position: absolute; inset: 0 auto 0 0; background: rgba(255, 255, 255, 0.18); transition: width 160ms ease; }
.run-content { position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.run-spinner { animation: run-spin 900ms linear infinite; }
@keyframes status-pulse { 50% { opacity: 0.4; } }
@keyframes run-spin { to { transform: rotate(360deg); } }
@media (max-width: 900px) {
  .auto-layer-action-bar { align-items: stretch; flex-direction: column; gap: 7px; }
  .auto-layer-status { overflow-x: auto; }
  .auto-layer-actions { justify-content: flex-end; overflow-x: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .status-dot.active,
  .run-spinner { animation: none; }
  .run-progress { transition: none; }
}
</style>
