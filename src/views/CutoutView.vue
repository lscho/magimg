<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import CutoutResultPanel from "@/components/cutout/CutoutResultPanel.vue";
import CutoutWorkspace from "@/components/cutout/CutoutWorkspace.vue";
import LoginModal from "@/components/LoginModal.vue";
import { useCutoutInference } from "@/composables/useCutoutInference";
import {
  chooseImageFile,
  copyImageBlobToClipboard,
  saveImageBlobsToDirectory,
  saveImageBlobAs,
  selectedImageFileFromFile
} from "@/services/desktop";
import { consumeCutoutHandoff } from "@/services/cutoutHandoff";
import { useAppStore } from "@/stores/app";
import { ApiError } from "@/services/apiClient";
import type { CutoutResult, CutoutSelectionBox, SelectedImageFile } from "@/types";

const app = useAppStore();
const inference = useCutoutInference();

const selectedFile = shallowRef<SelectedImageFile | null>(null);
const sessionKey = shallowRef(0);
const selecting = shallowRef(false);
const clearing = shallowRef(false);
const selections = shallowRef<CutoutSelectionBox[]>([]);
const results = shallowRef<CutoutResult[]>([]);
const imageSource = shallowRef<{ source: CanvasImageSource; width: number; height: number } | null>(null);
const copyingId = shallowRef<string | null>(null);
const savingId = shallowRef<string | null>(null);
const exportingAll = shallowRef(false);
const actionError = shallowRef("");
const actionMessage = shallowRef("");
const showLogin = shallowRef(false);
const mattingInsufficient = shallowRef(false);
let actionMessageTimer: number | undefined;

const source = computed(() => {
  const file = selectedFile.value;
  if (!file) return null;
  return { blob: file.file, mimeType: file.file.type || "image/png" };
});

const fileBaseName = computed(() => {
  const name = selectedFile.value?.name || "huanhua-image";
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 ? name.slice(0, dotIndex) : name;
});

const mattingCost = computed(() => app.capabilities.mattingCost);
const insufficientCredits = computed(
  () =>
    app.isAuthenticated &&
    (app.balance.balance < mattingCost.value || mattingInsufficient.value)
);

watch(
  () => app.balance.balance,
  (next) => {
    if (mattingInsufficient.value && next >= mattingCost.value) {
      mattingInsufficient.value = false;
      if (actionError.value === "积分不足，请充值后继续抠图。") actionError.value = "";
    }
  }
);

function showMessage(message: string) {
  actionMessage.value = message;
  if (actionMessageTimer) window.clearTimeout(actionMessageTimer);
  actionMessageTimer = window.setTimeout(() => {
    actionMessage.value = "";
    actionMessageTimer = undefined;
  }, 2400);
}

function loadSelectedImage(selected: SelectedImageFile) {
  selectedFile.value = selected;
  selections.value = [];
  results.value = [];
  imageSource.value = null;
  sessionKey.value += 1;
}

async function chooseImage() {
  if (selecting.value) return;
  selecting.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    const selected = await chooseImageFile();
    if (selected) loadSelectedImage(selected);
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请重新选择。";
  } finally {
    selecting.value = false;
  }
}

function loadDroppedImage(file: File) {
  actionError.value = "";
  actionMessage.value = "";
  try {
    loadSelectedImage(selectedImageFileFromFile(file));
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请重新选择。";
  }
}

async function importImage() {
  if (selecting.value) return;
  await chooseImage();
}

async function clearImage() {
  if (clearing.value || !selectedFile.value) return;
  const confirmed = window.confirm("确定清空当前图片与所有框选结果吗？该操作不可撤销。");
  if (!confirmed) return;
  clearing.value = true;
  try {
    selectedFile.value = null;
    selections.value = [];
    results.value = [];
    imageSource.value = null;
    sessionKey.value += 1;
  } finally {
    clearing.value = false;
  }
}

function handleReady(payload: { source: CanvasImageSource; width: number; height: number }) {
  imageSource.value = payload;
}

function handleSelectionsChange(next: CutoutSelectionBox[]) {
  const changed =
    next.length !== selections.value.length ||
    next.some((selection, index) => {
      const current = selections.value[index];
      return (
        !current ||
        current.id !== selection.id ||
        current.x !== selection.x ||
        current.y !== selection.y ||
        current.width !== selection.width ||
        current.height !== selection.height
      );
    });
  selections.value = next;
  if (changed && inference.phase.value === "idle") results.value = [];
}

async function installResources() {
  const installed = await inference.installResourcePackage();
  if (installed) showMessage("AI 抠图资源已就绪");
}

async function segment() {
  if (!app.isAuthenticated) {
    showLogin.value = true;
    return;
  }
  if (!imageSource.value || inference.phase.value !== "idle") return;
  if (!selections.value.length) {
    actionError.value = "请先在画布上框选要抠取的元素。";
    return;
  }
  actionError.value = "";
  actionMessage.value = "";
  results.value = [];
  const requestedSelections = selections.value.map((selection) => ({ ...selection }));
  const produced: CutoutResult[] = [];

  let mattingId: string | null = null;
  try {
    const charge = await app.chargeMatting();
    mattingId = charge.mattingId;
  } catch (exception) {
    if (exception instanceof ApiError && exception.statusCode === 409) {
      mattingInsufficient.value = true;
      actionError.value = "积分不足，请充值后继续抠图。";
    } else {
      actionError.value = exception instanceof Error
        ? exception.message
        : "积分扣除失败，请稍后重试。";
    }
    return;
  }

  await inference.segmentSelections(
    imageSource.value.source,
    imageSource.value.width,
    imageSource.value.height,
    requestedSelections,
    fileBaseName.value,
    (result) => {
      produced.push(result);
      results.value = [...produced];
    }
  );

  if (inference.error.value && mattingId) {
    try {
      await app.refundMatting(mattingId);
    } catch (exception) {
      console.warn("抠图退款失败", exception);
      actionError.value = "抠图失败且退款异常，请联系客服处理。";
      return;
    }
  }

  if (results.value.length) showMessage(`已抠取 ${results.value.length} 个素材`);
}

function onLoginSuccess() {
  showLogin.value = false;
  void segment();
}

async function copyResult(result: CutoutResult) {
  if (copyingId.value) return;
  copyingId.value = result.id;
  actionError.value = "";
  actionMessage.value = "";
  try {
    await copyImageBlobToClipboard(result.blob);
    showMessage("透明素材已复制");
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "复制失败，请稍后重试。";
  } finally {
    copyingId.value = null;
  }
}

async function saveResult(result: CutoutResult) {
  if (savingId.value) return;
  savingId.value = result.id;
  actionError.value = "";
  actionMessage.value = "";
  try {
    const savedPath = await saveImageBlobAs(result.blob, result.baseName, "image/png");
    if (savedPath) showMessage("素材已保存");
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "保存失败，请稍后重试。";
  } finally {
    savingId.value = null;
  }
}

function removeResult(id: string) {
  results.value = results.value.filter((result) => result.id !== id);
}

async function exportAll() {
  if (!results.value.length || exportingAll.value) return;
  exportingAll.value = true;
  actionError.value = "";
  actionMessage.value = "";
  try {
    const outcome = await saveImageBlobsToDirectory(
      results.value.map((result) => ({
        blob: result.blob,
        suggestedName: result.baseName,
        mimeType: "image/png"
      }))
    );
    if (outcome.savedCount) showMessage(`已导出 ${outcome.savedCount} 个素材`);
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "导出失败，请稍后重试。";
  } finally {
    exportingAll.value = false;
  }
}

const handoff = consumeCutoutHandoff();
if (handoff) {
  loadSelectedImage(handoff.selectedFile);
}

onBeforeUnmount(() => {
  if (actionMessageTimer) window.clearTimeout(actionMessageTimer);
});
</script>

<template>
  <section class="page-view cutout-view">
    <div class="cutout-layout">
      <CutoutWorkspace
        :key="sessionKey"
        :source="source"
        :importing="selecting"
        :clearing="clearing"
        :locked="inference.phase.value === 'processing'"
        @ready="handleReady"
        @selections-change="handleSelectionsChange"
        @import="importImage"
        @clear="clearImage"
        @drop-file="loadDroppedImage"
      />
      <CutoutResultPanel
        :results="results"
        :phase="inference.phase.value"
        :resource-status="inference.resourceStatus.value"
        :resource-progress="inference.resourceProgress.value"
        :resource-download-size-bytes="inference.resourceDownloadSizeBytes"
        :progress="inference.progress.value"
        :error="inference.error.value || actionError"
        :copying-id="copyingId"
        :saving-id="savingId"
        :exporting-all="exportingAll"
        :has-image="Boolean(imageSource)"
        :selection-count="selections.length"
        :local-models-supported="inference.localModelsSupported"
        :cost="mattingCost"
        :balance="app.balance.balance"
        :is-logged-in="app.isAuthenticated"
        :insufficient-credits="insufficientCredits"
        @install-resources="installResources"
        @segment="segment"
        @cancel="inference.cancel"
        @export-all="exportAll"
        @copy-result="copyResult"
        @save-result="saveResult"
        @remove-result="removeResult"
      />
    </div>
    <p v-if="actionMessage" class="cutout-view-feedback" role="status">{{ actionMessage }}</p>
    <LoginModal v-if="showLogin" context="matting" @close="showLogin = false" @success="onLoginSuccess" />
  </section>
</template>

<style scoped lang="scss">
.cutout-view {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.cutout-layout {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(320px, 22vw, 360px);
  gap: 0;
  overflow: hidden;
}


.cutout-view-feedback {
  position: absolute;
  z-index: 5;
  right: 380px;
  bottom: 16px;
  max-width: min(360px, calc(100% - 400px));
  margin: 0;
  padding: 8px 11px;
  border: 1px solid rgba(101, 211, 173, 0.34);
  border-radius: 6px;
  color: var(--success);
  background: var(--surface-raised);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
  font-size: 11px;
  font-weight: 600;
}

@media (max-width: 1180px) {
  .cutout-layout {
    grid-template-columns: minmax(0, 1fr) 320px;
  }

  .cutout-view-feedback {
    right: 340px;
  }
}

@media (max-width: 900px) {
  .cutout-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) auto;
    overflow: auto;
  }

  .cutout-view-feedback {
    right: 16px;
    bottom: 16px;
    max-width: calc(100% - 32px);
  }
}
</style>
