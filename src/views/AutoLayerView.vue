<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { Image as ImageIcon } from "lucide-vue-next";
import AutoLayerResultWorkspace from "@/components/auto-layer/AutoLayerResultWorkspace.vue";
import type { AutoLayerDocument, AutoLayerItem } from "@/components/auto-layer/types";
import CutoutWorkspace from "@/components/cutout/CutoutWorkspace.vue";
import LoginModal from "@/components/LoginModal.vue";
import { useCutoutInference } from "@/composables/useCutoutInference";
import { ApiError } from "@/services/apiClient";
import {
  chooseImageFile,
  selectedImageFileFromFile
} from "@/services/desktop";
import { createAutoLayerItems } from "@/services/autoLayerModel";
import { cloneCutoutSelections } from "@/services/cutoutSelectionModel";
import { useAppStore } from "@/stores/app";
import type {
  CutoutSelection,
  MattingChargeResult,
  SelectedImageFile
} from "@/types";

const app = useAppStore();
const inference = useCutoutInference();

const selectedFile = shallowRef<SelectedImageFile | null>(null);
const imageSource = shallowRef<{ source: CanvasImageSource; width: number; height: number } | null>(null);
const selections = shallowRef<CutoutSelection[]>([]);
const document = shallowRef<AutoLayerDocument | null>(null);
const sessionKey = shallowRef(0);
const selecting = shallowRef(false);
const clearing = shallowRef(false);
const showLogin = shallowRef(false);
const insufficient = shallowRef(false);
const actionError = shallowRef("");
const actionMessage = shallowRef("");
let actionMessageTimer: number | undefined;

const source = computed(() => selectedFile.value
  ? { blob: selectedFile.value.file, mimeType: selectedFile.value.file.type || "image/png" }
  : null
);
const cost = computed(() => app.capabilities.mattingCost);
const insufficientCredits = computed(() =>
  app.isAuthenticated && (app.balance.balance < cost.value || insufficient.value)
);

watch(
  () => app.balance.balance,
  (balance) => {
    if (insufficient.value && balance >= cost.value) insufficient.value = false;
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
  imageSource.value = null;
  selections.value = [];
  document.value = null;
  actionError.value = "";
  actionMessage.value = "";
  sessionKey.value += 1;
}

async function chooseImage() {
  if (selecting.value) return;
  selecting.value = true;
  actionError.value = "";
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
  try {
    loadSelectedImage(selectedImageFileFromFile(file));
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请重新选择。";
  }
}

async function clearImage() {
  if (!selectedFile.value || clearing.value) return;
  if (!window.confirm("确定清空当前图片、选区与分层结果吗？")) return;
  clearing.value = true;
  selectedFile.value = null;
  imageSource.value = null;
  selections.value = [];
  document.value = null;
  sessionKey.value += 1;
  clearing.value = false;
}

function handleReady(payload: { source: CanvasImageSource; width: number; height: number }) {
  imageSource.value = payload;
}

function handleSelectionsChange(next: CutoutSelection[]) {
  const normalized = cloneCutoutSelections(next);
  const changed = JSON.stringify(normalized) !== JSON.stringify(selections.value);
  selections.value = normalized;
  if (changed && inference.phase.value === "idle") document.value = null;
}

function updateLayers(layers: AutoLayerItem[]) {
  if (!document.value) return;
  document.value = { ...document.value, layers };
}

async function installResources() {
  const installed = await inference.installResourcePackage();
  if (installed) showMessage("抠图资源已就绪");
}

async function installRepairResource() {
  const installed = await inference.installRepairResource();
  if (installed) showMessage("背景修复模型已就绪");
}

async function createLayers() {
  if (!app.isAuthenticated) {
    showLogin.value = true;
    return;
  }
  const image = imageSource.value;
  if (!image || inference.phase.value !== "idle") return;
  if (!selections.value.length) {
    actionError.value = "请先在左侧原图上框选要分层的内容。";
    return;
  }
  actionError.value = "";
  actionMessage.value = "";
  document.value = null;

  let charge: MattingChargeResult | null = null;
  try {
    charge = await app.chargeMatting("local");
  } catch (exception) {
    if (exception instanceof ApiError && exception.statusCode === 409) {
      insufficient.value = true;
      actionError.value = "积分不足，请充值后继续分层。";
    } else {
      actionError.value = exception instanceof Error ? exception.message : "积分扣除失败，请稍后重试。";
    }
    return;
  }

  const output = await inference.createAutoLayers(
    image.source,
    image.width,
    image.height,
    cloneCutoutSelections(selections.value)
  );
  if (!output) {
    if (charge) {
      try {
        await app.refundMatting(charge.mattingId);
      } catch (exception) {
        console.warn("自动分层退款失败", exception);
        actionError.value = "自动分层失败且退款异常，请联系客服处理。";
      }
    }
    return;
  }

  document.value = {
    backgroundBlob: output.backgroundBlob,
    width: image.width,
    height: image.height,
    layers: createAutoLayerItems(output.materials)
  };
  showMessage(`已生成 ${output.materials.length} 个可编辑图层`);
}

function handleLoginSuccess() {
  showLogin.value = false;
  void createLayers();
}

onBeforeUnmount(() => {
  if (actionMessageTimer) window.clearTimeout(actionMessageTimer);
});
</script>

<template>
  <section class="page-view auto-layer-view">
    <div class="auto-layer-layout">
      <section class="auto-layer-source" aria-label="原图与框选">
        <header class="auto-layer-source-header">
          <div>
            <ImageIcon :size="16" aria-hidden="true" />
            <h2>原图</h2>
          </div>
          <span>{{ selections.length }} 个选区</span>
        </header>
        <CutoutWorkspace
          :key="sessionKey"
          :source="source"
          :initial-selections="selections"
          :importing="selecting"
          :clearing="clearing"
          :locked="inference.phase.value === 'processing'"
          @ready="handleReady"
          @selections-change="handleSelectionsChange"
          @import="chooseImage"
          @clear="clearImage"
          @drop-file="loadDroppedImage"
        />
      </section>

      <AutoLayerResultWorkspace
        :document="document"
        :phase="inference.phase.value"
        :progress="inference.progress.value"
        :resource-status="inference.resourceStatus.value"
        :resource-progress="inference.resourceProgress.value"
        :repair-resource-status="inference.repairResourceStatus.value"
        :repair-progress="inference.repairProgress.value"
        :local-models-supported="inference.localModelsSupported"
        :has-image="Boolean(imageSource)"
        :selection-count="selections.length"
        :is-logged-in="app.isAuthenticated"
        :insufficient-credits="insufficientCredits"
        :cost="cost"
        :balance="app.balance.balance"
        :error="inference.error.value || actionError"
        @install-resources="installResources"
        @install-repair-resource="installRepairResource"
        @layer="createLayers"
        @cancel="inference.cancel"
        @update-layers="updateLayers"
      />
    </div>

    <p v-if="actionMessage" class="auto-layer-feedback" role="status">{{ actionMessage }}</p>
    <LoginModal
      v-if="showLogin"
      context="matting"
      @close="showLogin = false"
      @success="handleLoginSuccess"
    />
  </section>
</template>

<style scoped lang="scss">
.auto-layer-view {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.auto-layer-layout {
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  overflow: hidden;
}

.auto-layer-source {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr);
  overflow: hidden;
  border-right: 1px solid var(--line);
  background: var(--surface);
}

.auto-layer-source-header {
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

.auto-layer-feedback {
  position: absolute;
  z-index: 6;
  right: 16px;
  bottom: 16px;
  max-width: min(360px, calc(100% - 32px));
  margin: 0;
  padding: 8px 11px;
  border: 1px solid rgba(101, 211, 173, 0.34);
  border-radius: 6px;
  color: var(--success);
  background: var(--surface-raised);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.32);
  font-size: 11px;
  font-weight: 650;
}

@media (max-width: 900px) {
  .auto-layer-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(520px, 1fr) minmax(520px, 1fr);
    overflow: auto;
  }

  .auto-layer-source { border-right: 0; border-bottom: 1px solid var(--line); }
}
</style>
