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
import {
  imageBlobSource,
  maskToPngBlob
} from "@/services/cutoutBackgroundRepair";
import { cloneCutoutSelections } from "@/services/cutoutSelectionModel";
import { useAppStore } from "@/stores/app";
import { ApiError } from "@/services/apiClient";
import type {
  CutoutResult,
  CutoutRepairMode,
  CutoutSelection,
  CutoutSelectionBox,
  MattingChargeResult,
  SelectedImageFile
} from "@/types";

const app = useAppStore();
const inference = useCutoutInference({ segmentationModel: "birefnet" });

const selectedFile = shallowRef<SelectedImageFile | null>(null);
const sessionKey = shallowRef(0);
const selecting = shallowRef(false);
const clearing = shallowRef(false);
const selections = shallowRef<CutoutSelection[]>([]);
const results = shallowRef<CutoutResult[]>([]);
const repairMode = shallowRef<CutoutRepairMode>("local");
const cloudInputAssetId = shallowRef<string | null>(null);
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

const hasBackgroundSelections = computed(() =>
  selections.value.some((selection) => selection.behavior === "background")
);
const cloudRepairEnabled = computed(() =>
  app.capabilities.backgroundRepairEnabled === true
);
const mattingCost = computed(() =>
  hasBackgroundSelections.value && repairMode.value === "cloud"
    ? app.capabilities.backgroundRepairCost ?? app.capabilities.mattingCost
    : app.capabilities.mattingCost
);
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

watch(cloudRepairEnabled, (enabled) => {
  if (!enabled && repairMode.value === "cloud") repairMode.value = "local";
});

function showMessage(message: string) {
  actionMessage.value = message;
  if (actionMessageTimer) window.clearTimeout(actionMessageTimer);
  actionMessageTimer = window.setTimeout(() => {
    actionMessage.value = "";
    actionMessageTimer = undefined;
  }, 2400);
}

function loadSelectedImage(
  selected: SelectedImageFile,
  restoredSelections: (CutoutSelection | CutoutSelectionBox)[] = [],
  restoredResults: CutoutResult[] = [],
  restoredCloudInputAssetId: string | null = null
) {
  selectedFile.value = selected;
  selections.value = cloneCutoutSelections(restoredSelections);
  results.value = [...restoredResults];
  cloudInputAssetId.value = restoredCloudInputAssetId;
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
    cloudInputAssetId.value = null;
    imageSource.value = null;
    sessionKey.value += 1;
  } finally {
    clearing.value = false;
  }
}

function handleReady(payload: { source: CanvasImageSource; width: number; height: number }) {
  imageSource.value = payload;
}

function handleSelectionsChange(next: CutoutSelection[]) {
  const normalized = cloneCutoutSelections(next);
  const changed = JSON.stringify(normalized) !== JSON.stringify(selections.value);
  selections.value = normalized;
  if (changed && inference.phase.value === "idle") results.value = [];
}

async function installResources() {
  const installed = await inference.installResourcePackage();
  if (installed) showMessage("AI 抠图资源已就绪");
}

async function installRepairResource() {
  const installed = await inference.installRepairResource();
  if (installed) showMessage("本地背景修复模型已就绪");
}

function setRepairMode(mode: CutoutRepairMode) {
  if (mode === "cloud" && !cloudRepairEnabled.value) return;
  repairMode.value = mode;
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
  const requestedMode: CutoutRepairMode = hasBackgroundSelections.value
    ? repairMode.value
    : "local";
  if (requestedMode === "cloud") {
    if (!cloudRepairEnabled.value) {
      actionError.value = "云端背景修复当前不可用。";
      return;
    }
    const maxBytes = app.capabilities.backgroundRepairMaxBytes;
    const maxPixels = app.capabilities.backgroundRepairMaxPixels;
    if (maxBytes && !cloudInputAssetId.value && selectedFile.value && selectedFile.value.file.size > maxBytes) {
      actionError.value = "图片大小超过云端背景修复限制。";
      return;
    }
    if (maxPixels && imageSource.value.width * imageSource.value.height > maxPixels) {
      actionError.value = "图片像素超过云端背景修复限制。";
      return;
    }
  }
  if (
    requestedMode === "local" &&
    hasBackgroundSelections.value &&
    inference.repairResourceStatus.value !== "ready"
  ) {
    actionError.value = "请先下载本地背景修复模型。";
    return;
  }
  actionError.value = "";
  actionMessage.value = "";
  results.value = [];
  let requestedSelections = cloneCutoutSelections(selections.value);
  let resolvedSelections = requestedSelections;
  const produced: CutoutResult[] = [];
  let cloudSubmitted = false;

  let charge: MattingChargeResult | null = null;
  try {
    charge = await app.chargeMatting(requestedMode);
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
    },
    {
      repairMode: requestedMode,
      onSelectionsResolved: (next) => {
        resolvedSelections = cloneCutoutSelections(next);
      },
      cloudRepair: requestedMode === "cloud" && selectedFile.value && charge
        ? async (mask, selectionBoxes, context) => {
          context.setStage("uploading");
          const maskBlob = await maskToPngBlob(
            mask,
            imageSource.value!.width,
            imageSource.value!.height
          );
          const submit = (inputAssetId?: string) => app.createBackgroundRepair({
            ...(inputAssetId
              ? { inputAssetId }
              : { image: selectedFile.value!.file }),
            mask: maskBlob,
            mattingId: charge!.mattingId,
            selectionBoxes: selectionBoxes.map((box) => ({ ...box }))
          });
          let task;
          try {
            task = await submit(cloudInputAssetId.value ?? undefined);
          } catch (exception) {
            const reusableAssetUnavailable = Boolean(cloudInputAssetId.value) &&
              exception instanceof ApiError &&
              (exception.statusCode === 400 || exception.statusCode === 404);
            if (!reusableAssetUnavailable) throw exception;
            cloudInputAssetId.value = null;
            task = await submit();
          }
          if (task.inputAssetId) cloudInputAssetId.value = task.inputAssetId;
          cloudSubmitted = true;
          context.setStage("waiting");
          const completed = await app.waitForBackgroundRepair(task, context.signal);
          const blob = await app.downloadBackgroundRepairOutput(completed);
          const bitmap = await imageBlobSource(blob);
          if (
            bitmap.width !== imageSource.value!.width ||
            bitmap.height !== imageSource.value!.height
          ) {
            bitmap.close();
            throw new Error("云端背景修复返回的图片尺寸与原图不一致。");
          }
          return bitmap;
        }
        : undefined
    }
  );

  if (JSON.stringify(resolvedSelections) !== JSON.stringify(selections.value)) {
    requestedSelections = resolvedSelections;
    selections.value = cloneCutoutSelections(resolvedSelections);
    sessionKey.value += 1;
  }

  if (inference.error.value && charge) {
    try {
      if (requestedMode === "cloud" && cloudSubmitted) {
        await app.refreshBalance();
      } else {
        await app.refundMatting(charge.mattingId);
      }
    } catch (exception) {
      console.warn("抠图退款失败", exception);
      actionError.value = "抠图失败且退款异常，请联系客服处理。";
      return;
    }
    return;
  }

  if (produced.length && charge && selectedFile.value) {
    try {
      await app.addCutoutHistory({
        mattingId: charge.mattingId,
        costCredits: charge.cost,
        selectedFile: selectedFile.value,
        sourceWidth: imageSource.value.width,
        sourceHeight: imageSource.value.height,
        selections: requestedSelections,
        results: produced,
        cloudInputAssetId: cloudInputAssetId.value ?? undefined
      });
    } catch (exception) {
      actionError.value = exception instanceof Error
        ? exception.message
        : "抠图结果已生成，但保存历史失败。";
    }
    const backgroundCount = produced.filter((result) => result.kind === "background").length;
    showMessage(backgroundCount
      ? `已生成 ${produced.length - backgroundCount} 个素材、${backgroundCount} 个背景`
      : `已抠取 ${produced.length} 个素材`);
  }
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
    showMessage(result.kind === "background" ? "背景素材已复制" : "透明素材已复制");
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
    if (savedPath) showMessage(result.kind === "background" ? "背景已保存" : "素材已保存");
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
  loadSelectedImage(
    handoff.selectedFile,
    handoff.selections ?? [],
    handoff.results ?? [],
    handoff.cloudInputAssetId ?? null
  );
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
        :initial-selections="selections"
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
        :progress="inference.progress.value"
        :error="inference.error.value || actionError"
        :copying-id="copyingId"
        :saving-id="savingId"
        :exporting-all="exportingAll"
        :has-image="Boolean(imageSource)"
        :selection-count="selections.length"
        :has-background-selections="hasBackgroundSelections"
        :repair-mode="repairMode"
        :cloud-repair-enabled="cloudRepairEnabled"
        :repair-resource-status="inference.repairResourceStatus.value"
        :repair-progress="inference.repairProgress.value"
        :local-models-supported="inference.localModelsSupported"
        :cost="mattingCost"
        :balance="app.balance.balance"
        :is-logged-in="app.isAuthenticated"
        :insufficient-credits="insufficientCredits"
        @install-resources="installResources"
        @install-repair-resource="installRepairResource"
        @set-repair-mode="setRepairMode"
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
