<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import { Image as ImageIcon } from "lucide-vue-next";
import AutoLayerActionBar from "@/components/auto-layer/AutoLayerActionBar.vue";
import AutoLayerResourceDownloadModal from "@/components/auto-layer/AutoLayerResourceDownloadModal.vue";
import AutoLayerResultWorkspace from "@/components/auto-layer/AutoLayerResultWorkspace.vue";
import AutoLayerSelectionHistoryModal from "@/components/auto-layer/AutoLayerSelectionHistoryModal.vue";
import AutoLayerSplitHandle from "@/components/auto-layer/AutoLayerSplitHandle.vue";
import CutoutWorkspace from "@/components/cutout/CutoutWorkspace.vue";
import LoginModal from "@/components/LoginModal.vue";
import { useAutoLayerWorkflow } from "@/composables/useAutoLayerWorkflow";

const workflow = useAutoLayerWorkflow();
const showResourceDownload = shallowRef(false);
const splitPercent = shallowRef(50);
const resizing = shallowRef(false);
const hasCompleteResult = computed(() => workflow.document.value?.status === "complete");
const drawerVisible = computed(() => hasCompleteResult.value && workflow.drawerOpen.value);
const layoutStyle = computed(() => ({
  "--source-panel": `${splitPercent.value}fr`,
  "--result-panel": `${100 - splitPercent.value}fr`
}));
const canRun = computed(() => Boolean(
  workflow.imageSource.value &&
  workflow.selections.value.length &&
  workflow.enabled.value &&
  !workflow.insufficientCredits.value &&
  !workflow.busy.value
));

function handleKeydown(event: KeyboardEvent) {
  if (showResourceDownload.value || workflow.selectionHistoryOpen.value) return;
  if (event.key === "Escape" && drawerVisible.value) workflow.drawerOpen.value = false;
}

function toggleDrawer() {
  if (hasCompleteResult.value) workflow.drawerOpen.value = !workflow.drawerOpen.value;
}

function handleRun() {
  if (workflow.recognitionResourceStatus.value !== "ready") {
    if (workflow.recognitionResourceStatus.value !== "checking"
      && workflow.recognitionResourceStatus.value !== "downloading") showResourceDownload.value = true;
    return;
  }
  void workflow.createLayers();
}

async function confirmResourceDownload() {
  showResourceDownload.value = false;
  if (await workflow.installRecognitionResource()) await workflow.createLayers();
}

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <section class="page-view auto-layer-view">
    <div
      class="auto-layer-layout"
      :class="{ 'has-result': hasCompleteResult, 'drawer-open': drawerVisible, resizing }"
      :style="layoutStyle"
    >
      <section class="auto-layer-source" aria-label="原图与框选">
        <header class="auto-layer-source-header">
          <div><ImageIcon :size="16" aria-hidden="true" /><h2>原图</h2></div>
          <span>{{ workflow.selections.value.length }} 个选区</span>
        </header>
        <CutoutWorkspace
          :key="workflow.sessionKey.value"
          mode="auto-layer"
          :source="workflow.source.value"
          :initial-selections="workflow.selections.value"
          :importing="workflow.selecting.value"
          :clearing="workflow.clearing.value"
          :locked="workflow.busy.value"
          @ready="workflow.handleReady"
          @selections-change="workflow.handleSelectionsChange"
          @import="workflow.chooseImage"
          @clear="workflow.clearImage"
          @drop-file="workflow.loadDroppedImage"
        />
      </section>

      <AutoLayerSplitHandle
        v-if="hasCompleteResult"
        class="auto-layer-divider"
        :value="splitPercent"
        @resize="splitPercent = $event"
        @dragging-change="resizing = $event"
      />

      <AutoLayerResultWorkspace
        v-if="hasCompleteResult && workflow.document.value"
        class="auto-layer-drawer"
        :document="workflow.document.value"
        @close="workflow.drawerOpen.value = false"
        @update-layers="workflow.updateLayers"
      />
    </div>

    <AutoLayerActionBar
      :stage="workflow.stage.value"
      :progress="workflow.progress.value"
      :resource-status="workflow.inference.resourceStatus.value"
      :recognition-resource-status="workflow.recognitionResourceStatus.value"
      :recognition-resource-progress="workflow.recognitionResourceProgress.value"
      :drawer-open="workflow.drawerOpen.value"
      :has-document="Boolean(workflow.document.value)"
      :can-open-drawer="hasCompleteResult"
      :has-selections="workflow.selections.value.length > 0"
      :can-package="workflow.canPackage.value"
      :can-save-selections="workflow.canSaveSelections.value"
      :can-open-selection-history="workflow.desktopAvailable.value && !workflow.busy.value"
      :selection-history-loading="workflow.selectionHistoryLoading.value"
      :can-run="canRun"
      :cost="workflow.cost.value"
      :balance="workflow.app.balance.balance"
      :error="workflow.inference.error.value || workflow.actionError.value"
      @install-resources="workflow.inference.installResourcePackage"
      @save-package="workflow.savePackage"
      @save-selections="workflow.saveSelections"
      @open-selection-history="workflow.openSelectionHistory"
      @toggle-drawer="toggleDrawer"
      @run="handleRun"
      @retry-cloud="workflow.retryCloudBackground"
      @cancel="workflow.cancel"
    />

    <p v-if="workflow.actionMessage.value" class="auto-layer-feedback" role="status">
      {{ workflow.actionMessage.value }}
    </p>
    <AutoLayerResourceDownloadModal
      v-if="showResourceDownload"
      @cancel="showResourceDownload = false"
      @confirm="confirmResourceDownload"
    />
    <AutoLayerSelectionHistoryModal
      v-if="workflow.selectionHistoryOpen.value"
      :records="workflow.selectionRecords.value"
      @close="workflow.selectionHistoryOpen.value = false"
      @restore="workflow.restoreSelections"
      @remove="workflow.removeSelectionRecord"
    />
    <LoginModal
      v-if="workflow.showLogin.value"
      context="matting"
      @close="workflow.showLogin.value = false"
      @success="workflow.handleLoginSuccess"
    />
  </section>
</template>

<style scoped lang="scss">
.auto-layer-view { position: relative; display: grid; grid-template-rows: minmax(0, 1fr) auto; overflow: hidden; padding: 0; }
.auto-layer-layout {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 0 minmax(0, 0fr);
  overflow: hidden;
  transition: grid-template-columns 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.auto-layer-layout.drawer-open { grid-template-columns: minmax(0, var(--source-panel)) 8px minmax(0, var(--result-panel)); }
.auto-layer-layout.resizing { transition: none; user-select: none; }
.auto-layer-source { grid-column: 1; min-width: 0; min-height: 0; display: grid; grid-template-rows: 44px minmax(0, 1fr); overflow: hidden; background: var(--surface); }
.auto-layer-divider { grid-column: 2; }
.drawer-open .auto-layer-divider { opacity: 1; pointer-events: auto; }
.auto-layer-drawer {
  grid-column: 3;
  min-width: 0;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translateX(18px);
  transition: opacity 160ms ease, transform 220ms cubic-bezier(0.22, 1, 0.36, 1), visibility 0s linear 220ms;
}
.drawer-open .auto-layer-drawer {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transform: translateX(0);
  transition-delay: 0s;
}
.auto-layer-source-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 12px; border-bottom: 1px solid var(--line); }
.auto-layer-source-header div { min-width: 0; display: flex; align-items: center; gap: 7px; color: var(--accent-strong); }
.auto-layer-source-header h2 { margin: 0; color: var(--text); font-size: 13px; font-weight: 680; letter-spacing: 0; }
.auto-layer-source-header span { color: var(--muted); font-size: 10px; white-space: nowrap; }
.auto-layer-feedback { position: absolute; z-index: 8; right: 16px; bottom: 70px; max-width: min(360px, calc(100% - 32px)); margin: 0; padding: 8px 11px; border: 1px solid rgba(101, 211, 173, 0.34); border-radius: 6px; color: var(--success); background: var(--surface-raised); box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32); font-size: 11px; font-weight: 650; }
@media (max-width: 899px) {
  .auto-layer-layout,
  .auto-layer-layout.drawer-open { grid-template-columns: minmax(0, 1fr); }
  .auto-layer-source,
  .auto-layer-drawer { grid-area: 1 / 1; width: 100%; }
  .auto-layer-divider { display: none; }
  .auto-layer-source { opacity: 1; visibility: visible; transition: opacity 160ms ease, visibility 0s; }
  .drawer-open .auto-layer-source { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 160ms ease, visibility 0s linear 160ms; }
}
@media (prefers-reduced-motion: reduce) {
  .auto-layer-layout,
  .auto-layer-drawer,
  .auto-layer-source { transition: none; }
  .auto-layer-drawer { transform: none; }
}
</style>
