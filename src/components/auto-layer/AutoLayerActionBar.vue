<script setup lang="ts">
import {
  ChevronUp,
  FileDown,
  FolderDown,
  History,
  Layers3,
  LoaderCircle,
  Package,
  PanelRightClose,
  PanelRightOpen,
  Save,
  X
} from "lucide-vue-next";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch
} from "vue";
import type {
  CutoutProgress,
  CutoutResourceProgress,
  CutoutResourceStatus
} from "@/composables/useCutoutInference";

const props = withDefaults(defineProps<{
  stage: "idle" | "local" | "uploading" | "waiting" | "complete" | "draft";
  progress: CutoutProgress | null;
  resourceStatus: CutoutResourceStatus;
  resourceProgress: CutoutResourceProgress | null;
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
  exportingPsd?: boolean;
}>(), { exportingPsd: false });

const emit = defineEmits<{
  savePackage: [];
  savePsd: [];
  saveSelections: [];
  openSelectionHistory: [];
  toggleDrawer: [];
  run: [];
  retryCloud: [];
  cancel: [];
}>();

const packageMenuOpen = shallowRef(false);
const packageActionRef = useTemplateRef<HTMLElement>("packageAction");
const packageButtonRef = useTemplateRef<HTMLButtonElement>("packageButton");
const packageMenuRef = useTemplateRef<HTMLElement>("packageMenu");
const busy = computed(() => ["local", "uploading", "waiting"].includes(props.stage));
const coreResourcesDownloading = computed(() => props.resourceStatus === "downloading");
const recognitionDownloading = computed(() => props.recognitionResourceStatus === "downloading");
const resourcesDownloading = computed(() => coreResourcesDownloading.value || recognitionDownloading.value);
const resourcesChecking = computed(() => props.resourceStatus === "checking"
  || props.recognitionResourceStatus === "checking");
const stageLabel = computed(() => {
  if (props.stage === "local") {
    return ({ segmenting: "识别元素", refining: "精修与 OCR", repairing: "清理父层", uploading: "上传", waiting: "等待" } as const)
      [props.progress?.stage ?? "segmenting"];
  }
  if (props.stage === "idle") return props.hasSelections ? "准备分层" : "等待框选";
  return ({ uploading: "上传原图与选区", waiting: "云端生成背景", complete: "分层完成", draft: "本地草稿" } as const)
    [props.stage as "uploading" | "waiting" | "complete" | "draft"];
});
const runDisabled = computed(() => !props.canRun || resourcesChecking.value || resourcesDownloading.value);
const resourceDownloadProgress = computed(() => {
  const activeProgress: number[] = [];
  if (coreResourcesDownloading.value) activeProgress.push(props.resourceProgress?.percent ?? 0);
  if (recognitionDownloading.value) activeProgress.push(props.recognitionResourceProgress);
  if (!activeProgress.length) return 0;
  return Math.round(activeProgress.reduce((sum, value) => sum + value, 0) / activeProgress.length);
});
const runLabel = computed(() => {
  if (resourcesDownloading.value) return `下载资源 ${resourceDownloadProgress.value}%`;
  return props.hasDocument ? "重新分层" : "一键分层";
});
const resourceProgressStyle = computed(() => ({ width: `${resourceDownloadProgress.value}%` }));

function packageMenuItems() {
  return [...(packageMenuRef.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
}

function closePackageMenu(restoreFocus = false) {
  if (!packageMenuOpen.value) return;
  packageMenuOpen.value = false;
  if (restoreFocus) void nextTick(() => packageButtonRef.value?.focus());
}

function togglePackageMenu() {
  if (!props.canPackage || busy.value) return;
  packageMenuOpen.value = !packageMenuOpen.value;
  if (packageMenuOpen.value) void nextTick(() => packageMenuItems()[0]?.focus());
}

function choosePackageAction(action: "psd" | "folder") {
  if (action === "psd" && props.exportingPsd) return;
  closePackageMenu();
  if (action === "psd") emit("savePsd");
  else emit("savePackage");
}

function handlePackageMenuKeydown(event: KeyboardEvent) {
  const items = packageMenuItems();
  if (!items.length) return;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  let next = current;
  if (event.key === "ArrowDown") next = (current + 1) % items.length;
  else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = items.length - 1;
  else if (event.key === "Escape") {
    event.preventDefault();
    closePackageMenu(true);
    return;
  } else return;
  event.preventDefault();
  items[next]?.focus();
}

function handleWindowPointerDown(event: PointerEvent) {
  if (packageMenuOpen.value && !packageActionRef.value?.contains(event.target as Node)) {
    closePackageMenu();
  }
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && packageMenuOpen.value) {
    event.preventDefault();
    closePackageMenu(true);
  }
}

watch(() => [props.canPackage, busy.value] as const, ([canPackage, isBusy]) => {
  if (!canPackage || isBusy) closePackageMenu();
});
onMounted(() => {
  window.addEventListener("pointerdown", handleWindowPointerDown);
  window.addEventListener("keydown", handleWindowKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", handleWindowPointerDown);
  window.removeEventListener("keydown", handleWindowKeydown);
});
</script>

<template>
  <footer class="auto-layer-action-bar" aria-label="自动分层操作">
    <div class="auto-layer-status">
      <span class="status-dot" :class="{ active: busy, complete: stage === 'complete', warning: stage === 'draft' }" />
      <strong>{{ stageLabel }}</strong>
      <span v-if="progress && stage === 'local'">{{ progress.current }}/{{ progress.total }}</span>
      <span>{{ cost }} 积分</span>
      <span>余额 {{ balance }}</span>
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
      <div ref="packageAction" class="package-action">
        <button
          ref="packageButton"
          type="button"
          :disabled="!canPackage || busy"
          aria-haspopup="menu"
          :aria-expanded="packageMenuOpen"
          @click="togglePackageMenu"
        >
          <Package :size="15" aria-hidden="true" /> 打包保存
          <ChevronUp class="package-chevron" :class="{ open: packageMenuOpen }" :size="13" aria-hidden="true" />
        </button>
        <div
          v-if="packageMenuOpen"
          ref="packageMenu"
          class="package-menu"
          role="menu"
          aria-label="打包保存方式"
          @keydown="handlePackageMenuKeydown"
        >
          <button
            type="button"
            role="menuitem"
            :disabled="exportingPsd"
            :aria-busy="exportingPsd"
            @click="choosePackageAction('psd')"
          >
            <LoaderCircle v-if="exportingPsd" class="run-spinner" :size="15" aria-hidden="true" />
            <FileDown v-else :size="15" aria-hidden="true" />
            <span>保存为 PSD</span>
          </button>
          <button type="button" role="menuitem" @click="choosePackageAction('folder')">
            <FolderDown :size="15" aria-hidden="true" />
            <span>保存为文件夹</span>
          </button>
        </div>
      </div>
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
        :aria-busy="resourcesDownloading"
        @click="emit('run')"
      >
        <span
          v-if="resourcesDownloading"
          class="run-progress"
          :style="resourceProgressStyle"
          aria-hidden="true"
        />
        <span class="run-content" aria-live="polite">
          <LoaderCircle v-if="resourcesDownloading" class="run-spinner" :size="15" aria-hidden="true" />
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
.package-action { position: relative; flex: 0 0 auto; }
.package-action > button { width: 100%; }
.package-chevron { transition: transform 160ms ease; }
.package-chevron.open { transform: rotate(180deg); }
.package-menu {
  position: absolute; z-index: 20; right: 0; bottom: calc(100% + 7px); width: 172px;
  display: grid; gap: 3px; padding: 5px; border: 1px solid var(--line-strong); border-radius: 7px;
  background: var(--surface-raised); box-shadow: 0 14px 34px rgba(0, 0, 0, 0.38);
}
.package-menu::after {
  position: absolute; right: 18px; bottom: -5px; width: 8px; height: 8px; content: "";
  border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong);
  background: var(--surface-raised); transform: rotate(45deg);
}
.package-menu button {
  position: relative; z-index: 1; width: 100%; min-height: 34px; justify-content: flex-start;
  padding: 0 9px; border-color: transparent; background: transparent;
}
.package-menu button:hover:not(:disabled),
.package-menu button:focus-visible { border-color: var(--line); background: var(--surface-subtle); }
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
  .auto-layer-actions { flex-wrap: wrap; justify-content: flex-end; overflow: visible; }
}
@media (prefers-reduced-motion: reduce) {
  .status-dot.active,
  .run-spinner { animation: none; }
  .run-progress,
  .package-chevron { transition: none; }
}
</style>
