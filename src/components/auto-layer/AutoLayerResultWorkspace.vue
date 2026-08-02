<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { Download, Layers3, LoaderCircle, PackageOpen, X } from "lucide-vue-next";
import type {
  CutoutPhase,
  CutoutProgress,
  CutoutResourceProgress,
  CutoutResourceStatus
} from "@/composables/useCutoutInference";
import AutoLayerCanvas from "./AutoLayerCanvas.vue";
import AutoLayerInspector from "./AutoLayerInspector.vue";
import type { AutoLayerDocument, AutoLayerItem } from "./types";

const props = defineProps<{
  document: AutoLayerDocument | null;
  phase: CutoutPhase;
  progress: CutoutProgress | null;
  resourceStatus: CutoutResourceStatus;
  resourceProgress: CutoutResourceProgress | null;
  repairResourceStatus: CutoutResourceStatus;
  repairProgress: CutoutResourceProgress | null;
  localModelsSupported: boolean;
  hasImage: boolean;
  selectionCount: number;
  isLoggedIn: boolean;
  insufficientCredits: boolean;
  cost: number;
  balance: number;
  error: string;
}>();

const emit = defineEmits<{
  installResources: [];
  installRepairResource: [];
  layer: [];
  cancel: [];
  updateLayers: [layers: AutoLayerItem[]];
}>();

const selectedId = shallowRef<string | null>(null);
const isWorking = computed(() => props.phase !== "idle");
const resourcesReady = computed(() =>
  props.resourceStatus === "ready" && props.repairResourceStatus === "ready"
);
const canLayer = computed(() =>
  props.phase === "idle" &&
  props.isLoggedIn &&
  !props.insufficientCredits &&
  props.hasImage &&
  props.selectionCount > 0 &&
  resourcesReady.value
);
const actionDisabled = computed(() =>
  props.isLoggedIn && (props.insufficientCredits || !canLayer.value)
);
const missingCredits = computed(() => Math.max(0, props.cost - props.balance));
const actionLabel = computed(() => {
  if (props.phase === "processing") return "分层中";
  if (!props.isLoggedIn) return "登录后分层";
  if (props.insufficientCredits) {
    return missingCredits.value > 0
      ? `积分不足，还需 ${missingCredits.value} 积分`
      : "积分不足，请先充值";
  }
  return props.document ? "重新分层" : "一键分层";
});
const progressLabel = computed(() => ({
  segmenting: "正在识别素材",
  refining: "正在精修边缘",
  repairing: "正在清理底图",
  uploading: "正在上传",
  waiting: "正在等待"
}[props.progress?.stage ?? "segmenting"]));
const installLabel = computed(() => {
  if (!props.localModelsSupported) return "仅桌面客户端可用";
  if (props.resourceStatus === "downloading") {
    return `抠图资源 ${props.resourceProgress?.percent ?? 0}%`;
  }
  if (props.repairResourceStatus === "downloading") {
    return `背景模型 ${props.repairProgress?.percent ?? 0}%`;
  }
  return "";
});

watch(
  () => props.document?.backgroundBlob,
  () => {
    selectedId.value = props.document?.layers.at(-1)?.id ?? null;
  }
);

function selectLayer(id: string) {
  selectedId.value = id;
}
</script>

<template>
  <section class="auto-layer-result" aria-label="自动分层结果">
    <header class="auto-layer-result-header">
      <div>
        <Layers3 :size="16" aria-hidden="true" />
        <h2>自动分层</h2>
      </div>
      <span>{{ document ? `${document.layers.length} 个图层` : `${selectionCount} 个选区` }}</span>
    </header>

    <div v-if="document" class="auto-layer-editor">
      <AutoLayerCanvas
        :background-blob="document.backgroundBlob"
        :image-width="document.width"
        :image-height="document.height"
        :layers="document.layers"
        :selected-id="selectedId"
        @select="selectLayer"
        @update-layers="emit('updateLayers', $event)"
      />
      <AutoLayerInspector
        :layers="document.layers"
        :selected-id="selectedId"
        :image-width="document.width"
        :image-height="document.height"
        @select="selectLayer"
        @update-layers="emit('updateLayers', $event)"
      />
    </div>
    <div v-else class="auto-layer-empty">
      <PackageOpen :size="32" aria-hidden="true" />
      <span>等待分层结果</span>
    </div>

    <footer class="auto-layer-footer">
      <div v-if="!resourcesReady" class="auto-layer-resource-actions">
        <button
          v-if="resourceStatus !== 'ready'"
          type="button"
          :disabled="isWorking || !localModelsSupported"
          @click="emit('installResources')"
        >
          <Download :size="13" aria-hidden="true" />
          {{ resourceStatus === 'downloading' ? `抠图资源 ${resourceProgress?.percent ?? 0}%` : '下载抠图资源' }}
        </button>
        <button
          v-if="repairResourceStatus !== 'ready'"
          type="button"
          :disabled="isWorking || !localModelsSupported"
          @click="emit('installRepairResource')"
        >
          <Download :size="13" aria-hidden="true" />
          {{ repairResourceStatus === 'downloading' ? `背景模型 ${repairProgress?.percent ?? 0}%` : '下载背景模型' }}
        </button>
        <span v-if="installLabel" role="status">{{ installLabel }}</span>
      </div>

      <p v-if="phase === 'processing' && progress" class="auto-layer-progress" role="status">
        <span>{{ progressLabel }} {{ progress.current }} / {{ progress.total }}</span>
        <span aria-hidden="true"><span :style="{ width: `${Math.round(progress.current / progress.total * 100)}%` }" /></span>
      </p>
      <p v-else-if="error && !insufficientCredits" class="auto-layer-error" role="alert">{{ error }}</p>
      <p v-else-if="isLoggedIn" class="auto-layer-credit">
        <span>预计消耗 {{ cost }} 积分</span>
        <span>余额 {{ balance }} 积分</span>
      </p>

      <div class="auto-layer-primary-actions" :class="{ 'has-cancel': isWorking }">
        <button v-if="isWorking" class="auto-layer-cancel" type="button" @click="emit('cancel')">
          <X :size="14" aria-hidden="true" />
          取消
        </button>
        <button
          class="auto-layer-primary"
          type="button"
          :disabled="actionDisabled"
          @click="emit('layer')"
        >
          <LoaderCircle v-if="isWorking" class="auto-layer-spinner" :size="15" aria-hidden="true" />
          <Layers3 v-else :size="15" aria-hidden="true" />
          {{ actionLabel }}
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped lang="scss">
.auto-layer-result {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr) auto;
  overflow: hidden;
  background: var(--surface);
}

.auto-layer-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);

  div { min-width: 0; display: flex; align-items: center; gap: 7px; color: var(--accent-strong); }
  h2 { margin: 0; color: var(--text); font-size: 13px; font-weight: 680; letter-spacing: 0; }
  > span { color: var(--muted); font-size: 10px; white-space: nowrap; }
}

.auto-layer-editor {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(210px, 16vw, 244px);
  overflow: hidden;
}

.auto-layer-empty {
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  color: var(--muted);
  background-color: var(--field);
  background-image:
    linear-gradient(45deg, var(--surface-subtle) 25%, transparent 25%),
    linear-gradient(-45deg, var(--surface-subtle) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--surface-subtle) 75%),
    linear-gradient(-45deg, transparent 75%, var(--surface-subtle) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  font-size: 11px;
}

.auto-layer-footer {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px 12px 12px;
  border-top: 1px solid var(--line);
  background: var(--surface);
}

.auto-layer-resource-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  button {
    min-width: 0;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 5px;
    color: var(--muted);
    background: var(--field);
    font-size: 9px;

    &:hover:not(:disabled) { color: var(--text); border-color: var(--line-strong); }
    &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    &:disabled { opacity: 0.48; cursor: not-allowed; }
  }

  span { flex-basis: 100%; color: var(--muted); font-size: 9px; }
}

.auto-layer-progress,
.auto-layer-error,
.auto-layer-credit {
  margin: 0;
  font-size: 10px;
}

.auto-layer-progress {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: var(--muted);

  > span:last-child {
    height: 3px;
    overflow: hidden;
    border-radius: 2px;
    background: var(--field);

    span { height: 100%; display: block; background: var(--accent); }
  }
}

.auto-layer-error { color: var(--danger); line-height: 1.4; }
.auto-layer-credit { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); }

.auto-layer-primary-actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 7px;

  &.has-cancel { grid-template-columns: 88px minmax(0, 1fr); }
}

.auto-layer-primary,
.auto-layer-cancel {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 680;

  &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
}

.auto-layer-primary {
  border: 1px solid var(--accent-border);
  color: var(--on-accent);
  background: var(--accent);

  &:disabled { color: var(--muted); border-color: var(--line); background: var(--field); cursor: not-allowed; }
}

.auto-layer-cancel { border: 1px solid var(--line); color: var(--muted); background: transparent; }
.auto-layer-spinner { animation: auto-layer-spin 0.8s linear infinite; }

@keyframes auto-layer-spin { to { transform: rotate(360deg); } }

@media (max-width: 1180px) {
  .auto-layer-editor { grid-template-columns: minmax(0, 1fr) 210px; }
}

@media (max-width: 900px) {
  .auto-layer-result { min-height: 520px; }
  .auto-layer-editor { grid-template-columns: minmax(0, 1fr) 220px; }
}

@media (prefers-reduced-motion: reduce) {
  .auto-layer-spinner { animation: none; }
}
</style>
