import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import type { AutoLayerDocument, AutoLayerItem } from "@/components/auto-layer/types";
import { useCutoutInference } from "@/composables/useCutoutInference";
import { ApiError } from "@/services/apiClient";
import { createAutoLayerItems, orderAutoLayersByHierarchy } from "@/services/autoLayerModel";
import { saveAutoLayerPackage } from "@/services/autoLayerExport";
import {
  applyAutoLayerRepairAtlas,
  autoLayerAtlasFileName,
  type AutoLayerRepairAtlas
} from "@/services/autoLayerRepairAtlas";
import { chooseImageFile, isDesktopApp, selectedImageFileFromFile } from "@/services/desktop";
import { cloneCutoutSelections } from "@/services/cutoutSelectionModel";
import {
  downloadAutoLayerRecognitionResources,
  getAutoLayerRecognitionStatus
} from "@/services/autoLayerRecognitionModelManager";
import {
  createAutoLayerSelectionRecord,
  readAutoLayerSelectionRecords,
  removeAutoLayerSelectionRecord,
  restoreAutoLayerSelectionRecord
} from "@/services/autoLayerSelectionHistory";
import { useAppStore } from "@/stores/app";
import type {
  AutoLayerSelectionRecord,
  AutoLayerTask,
  CutoutSelection,
  MattingChargeResult,
  SelectedImageFile
} from "@/types";

type WorkflowStage = "idle" | "local" | "uploading" | "waiting" | "complete" | "draft";

function isSucceededTask(task: AutoLayerTask | null): task is AutoLayerTask {
  return task?.status === "succeeded" && Boolean(task.outputUrl);
}

function isPendingTask(task: AutoLayerTask | null) {
  return task?.status === "pending" || task?.status === "processing";
}

export function useAutoLayerWorkflow() {
  const app = useAppStore();
  const inference = useCutoutInference();
  const selectedFile = shallowRef<SelectedImageFile | null>(null);
  const imageSource = shallowRef<{ source: CanvasImageSource; width: number; height: number } | null>(null);
  const selections = shallowRef<CutoutSelection[]>([]);
  const document = shallowRef<AutoLayerDocument | null>(null);
  const cloudAtlas = shallowRef<AutoLayerRepairAtlas | null>(null);
  const cloudSplitAtlas = shallowRef<AutoLayerRepairAtlas | null>(null);
  const cloudTask = shallowRef<AutoLayerTask | null>(null);
  const cloudSplitTask = shallowRef<AutoLayerTask | null>(null);
  const splitConfirmOpen = shallowRef(false);
  const sessionKey = shallowRef(0);
  const selecting = shallowRef(false);
  const clearing = shallowRef(false);
  const showLogin = shallowRef(false);
  const drawerOpen = shallowRef(false);
  const selectionHistoryOpen = shallowRef(false);
  const selectionHistoryLoading = shallowRef(false);
  const selectionRecords = shallowRef<AutoLayerSelectionRecord[]>([]);
  const insufficient = shallowRef(false);
  const stage = shallowRef<WorkflowStage>("idle");
  const actionError = shallowRef("");
  const actionMessage = shallowRef("");
  const controller = shallowRef<AbortController | null>(null);
  const recognitionResourceStatus = shallowRef<"checking" | "missing" | "downloading" | "ready" | "error">("checking");
  const recognitionResourceProgress = shallowRef(0);
  let messageTimer: number | undefined;
  let splitBaseCharge: MattingChargeResult | null = null;
  let pendingSubmission: Array<{ charge: MattingChargeResult; idempotencyKey: string }> | null = null;

  const source = computed(() => selectedFile.value
    ? { blob: selectedFile.value.file, mimeType: selectedFile.value.file.type || "image/png" }
    : null
  );
  const cost = computed(() => app.capabilities.autoLayerCost ?? 20);
  const enabled = computed(() => app.capabilities.autoLayerEnabled === true);
  const busy = computed(() => stage.value === "local" || stage.value === "uploading" || stage.value === "waiting"
    || recognitionResourceStatus.value === "downloading");
  const insufficientCredits = computed(() => app.isAuthenticated && (app.balance.balance < cost.value || insufficient.value));
  const canPackage = computed(() => document.value?.status === "complete");
  const progress = computed(() => inference.progress.value);
  const desktopAvailable = computed(() => isDesktopApp());
  const canSaveSelections = computed(() => isDesktopApp() && Boolean(
    selectedFile.value && imageSource.value && selections.value.length && !busy.value
  ));

  async function refreshRecognitionResource() {
    recognitionResourceStatus.value = await getAutoLayerRecognitionStatus();
  }

  async function installRecognitionResource(): Promise<boolean> {
    if (busy.value || recognitionResourceStatus.value === "downloading") return false;
    const abortController = new AbortController();
    controller.value = abortController;
    recognitionResourceStatus.value = "downloading";
    recognitionResourceProgress.value = 0;
    actionError.value = "";
    try {
      await downloadAutoLayerRecognitionResources(progress => {
        recognitionResourceProgress.value = Math.round(progress.receivedBytes / Math.max(1, progress.totalBytes) * 100);
      }, abortController.signal);
      recognitionResourceStatus.value = "ready";
      recognitionResourceProgress.value = 100;
      showMessage("自动分层识别资源已就绪");
      return true;
    } catch (error) {
      recognitionResourceStatus.value = "error";
      actionError.value = error instanceof Error ? error.message : "识别资源安装失败。";
      return false;
    } finally {
      controller.value = null;
    }
  }

  watch(() => app.balance.balance, balance => {
    if (insufficient.value && balance >= cost.value) insufficient.value = false;
  });

  function showMessage(message: string) {
    actionMessage.value = message;
    if (messageTimer) window.clearTimeout(messageTimer);
    messageTimer = window.setTimeout(() => { actionMessage.value = ""; }, 2400);
  }

  function resetSession(selected: SelectedImageFile | null, restoredSelections: CutoutSelection[] = []) {
    selectedFile.value = selected;
    imageSource.value = null;
    selections.value = cloneCutoutSelections(restoredSelections);
    document.value = null;
    cloudAtlas.value = null;
    cloudSplitAtlas.value = null;
    cloudTask.value = null;
    cloudSplitTask.value = null;
    splitConfirmOpen.value = false;
    splitBaseCharge = null;
    drawerOpen.value = false;
    actionError.value = "";
    stage.value = "idle";
    sessionKey.value += 1;
  }

  async function chooseImage() {
    if (selecting.value || busy.value) return;
    selecting.value = true;
    try {
      const selected = await chooseImageFile();
      if (selected) resetSession(selected);
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "图片读取失败，请重新选择。";
    } finally {
      selecting.value = false;
    }
  }

  function loadDroppedImage(file: File) {
    try { resetSession(selectedImageFileFromFile(file)); }
    catch (error) { actionError.value = error instanceof Error ? error.message : "图片读取失败。"; }
  }

  async function clearImage() {
    if (!selectedFile.value || clearing.value || !window.confirm("确定清空当前图片、选区与分层结果吗？")) return;
    clearing.value = true;
    resetSession(null);
    clearing.value = false;
  }

  function handleReady(payload: { source: CanvasImageSource; width: number; height: number }) {
    imageSource.value = payload;
  }

  function handleSelectionsChange(next: CutoutSelection[]) {
    const normalized = cloneCutoutSelections(next);
    const changed = JSON.stringify(normalized) !== JSON.stringify(selections.value);
    selections.value = normalized;
    if (changed && !busy.value) {
      document.value = null;
      cloudAtlas.value = null;
      cloudSplitAtlas.value = null;
      cloudTask.value = null;
      cloudSplitTask.value = null;
      splitConfirmOpen.value = false;
      splitBaseCharge = null;
      drawerOpen.value = false;
    }
  }

  function updateLayers(layers: AutoLayerItem[]) {
    if (document.value) document.value = { ...document.value, layers };
  }

  async function charge(): Promise<MattingChargeResult | null> {
    try {
      return await app.chargeMatting("autoLayer");
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 409) {
        insufficient.value = app.balance.balance < cost.value;
        actionError.value = insufficient.value ? "积分不足，请充值后继续分层。" : error.message;
      } else actionError.value = error instanceof Error ? error.message : "积分扣除失败，请稍后重试。";
      return null;
    }
  }

  async function submitAtlasTask(
    atlas: AutoLayerRepairAtlas,
    isBackground: boolean,
    chargeResult: MattingChargeResult,
    idempotencyKey: string
  ) {
    const documentValue = document.value;
    if (!documentValue) throw new Error("分层文档不存在。");
    return app.createAutoLayerTask({
      image: isBackground && documentValue.cloudInputAssetId
        ? undefined
        : new File([atlas.imageBlob], autoLayerAtlasFileName(atlas.imageBlob), {
          type: atlas.imageBlob.type || "image/png"
        }),
      inputAssetId: isBackground ? documentValue.cloudInputAssetId : undefined,
      mask: atlas.maskBlob,
      mattingId: chargeResult.mattingId,
      idempotencyKey
    });
  }

  async function applyCloudOutputs() {
    const atlas = cloudAtlas.value;
    const splitAtlas = cloudSplitAtlas.value;
    if (!atlas || !document.value) return;
    const outputs: Array<{ blob: Blob; itemAtlas: AutoLayerRepairAtlas }> = [];
    if (isSucceededTask(cloudTask.value)) {
      const task = cloudTask.value;
      outputs.push({ blob: await app.downloadAutoLayerOutput(task), itemAtlas: atlas });
    }
    if (splitAtlas && isSucceededTask(cloudSplitTask.value)) {
      const task = cloudSplitTask.value;
      outputs.push({
        blob: await app.downloadAutoLayerOutput(task),
        itemAtlas: splitAtlas
      });
    }
    let current = {
      backgroundBlob: document.value.backgroundBlob,
      layers: document.value.layers
    };
    for (const output of outputs) {
      current = await applyAutoLayerRepairAtlas(output.blob, output.itemAtlas, current);
    }
    if (!outputs.length) return;
    document.value = {
      ...document.value,
      backgroundBlob: current.backgroundBlob,
      layers: current.layers
    };
  }

  /**
   * 提交 1–2 张图集对应的云端任务（整页背景 + 可选父素材），
   * 全部创建成功后并行等待，成功输出按背景、素材顺序回填。
   * 任一任务失败时服务端独立退款；未创建成功的预扣由客户端退回。
   */
  async function createCloudBackgrounds(charges: MattingChargeResult[]) {
    const atlas = cloudAtlas.value;
    const splitAtlas = cloudSplitAtlas.value;
    if (!atlas || !document.value) return;
    if (splitAtlas && charges.length < 2) {
      throw new Error("父素材图集缺少预扣流水。");
    }
    const abortController = controller.value ?? new AbortController();
    controller.value = abortController;
    const items = [
      { atlas, isBackground: true, charge: charges[0], idempotencyKey: `huanhua:${crypto.randomUUID()}` },
      ...(splitAtlas ? [{
        atlas: splitAtlas,
        isBackground: false,
        charge: charges[1],
        idempotencyKey: `huanhua:${crypto.randomUUID()}`
      }] : [])
    ];
    let accepted = false;
    pendingSubmission = items.map(item => ({ charge: item.charge, idempotencyKey: item.idempotencyKey }));
    drawerOpen.value = false;
    try {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        stage.value = "uploading";
        const task = await submitAtlasTask(item.atlas, item.isBackground, item.charge, item.idempotencyKey);
        if (item.isBackground) cloudTask.value = task;
        else cloudSplitTask.value = task;
      }
      accepted = true;
      pendingSubmission = null;
      stage.value = "waiting";
      const completed = await Promise.all(
        items.map(item => app.waitForAutoLayerTask(
          item.isBackground ? cloudTask.value! : cloudSplitTask.value!,
          abortController.signal
        ))
      );
      for (let index = 0; index < items.length; index += 1) {
        const task = completed[index];
        if (items[index].isBackground) cloudTask.value = task;
        else cloudSplitTask.value = task;
      }
      await applyCloudOutputs();
      if (!isSucceededTask(cloudTask.value) ||
        (splitAtlas && !isSucceededTask(cloudSplitTask.value))) {
        throw new Error("云端背景生成失败，可只重试背景。");
      }
      document.value = {
        ...document.value,
        status: "complete",
        cloudInputAssetId: cloudTask.value?.inputAssetId
      };
      stage.value = "complete";
      drawerOpen.value = true;
      showMessage(`已生成 ${document.value.layers.length} 个可编辑图层`);
    } catch (error) {
      document.value = { ...document.value, status: "draft" };
      stage.value = "draft";
      drawerOpen.value = false;
      actionError.value = error instanceof Error ? error.message : "云端背景生成失败，可只重试背景。";
      const ambiguousNetworkFailure = error instanceof ApiError && error.statusCode === 0;
      if (!accepted && !ambiguousNetworkFailure) {
        pendingSubmission = null;
        // 已绑定任务的预扣由服务端在任务终态退款，只退回未创建任务的预扣。
        const unbound = items.filter(item => {
          const task = item.isBackground ? cloudTask.value : cloudSplitTask.value;
          return !task;
        }).map(item => item.charge);
        for (const charge of unbound) {
          await app.refundMatting(charge.mattingId).catch(() => undefined);
        }
      }
    } finally {
      controller.value = null;
    }
  }

  async function createLayers() {
    if (!app.isAuthenticated) { showLogin.value = true; return; }
    if (!enabled.value) { actionError.value = "服务端尚未启用自动分层。"; return; }
    if (splitConfirmOpen.value) return;
    const image = imageSource.value;
    if (!image || busy.value) return;
    if (!selections.value.length) { actionError.value = "请先框选元素或文字。"; return; }
    actionError.value = "";
    const chargeResult = await charge();
    if (!chargeResult) return;
    document.value = null;
    cloudAtlas.value = null;
    cloudTask.value = null;
    controller.value = new AbortController();
    stage.value = "local";
    const output = await inference.createAutoLayers(
      image.source,
      image.width,
      image.height,
      cloneCutoutSelections(selections.value),
      {
        cloudMaxPixels: app.capabilities.backgroundRepairMaxPixels,
        cloudMaxBytes: app.capabilities.backgroundRepairMaxBytes
      }
    );
    if (!output) {
      stage.value = "idle";
      await app.refundMatting(chargeResult.mattingId).catch(() => undefined);
      controller.value = null;
      return;
    }
    cloudAtlas.value = output.cloudAtlas ?? null;
    cloudSplitAtlas.value = output.splitCloudAtlas ?? null;
    document.value = {
      backgroundBlob: output.backgroundBlob,
      width: image.width,
      height: image.height,
      layers: orderAutoLayersByHierarchy([
        ...createAutoLayerItems(output.materials),
        ...output.texts
      ]),
      status: "draft"
    };
    stage.value = "draft";
    drawerOpen.value = false;
    if (!cloudAtlas.value) {
      // 纯色/渐变背景已在本地直接提取，无云端任务：退还预扣积分并完成分层。
      await app.refundMatting(chargeResult.mattingId).catch(() => undefined);
      document.value = { ...document.value, status: "complete" };
      stage.value = "complete";
      drawerOpen.value = true;
      controller.value = null;
      showMessage(`已生成 ${document.value.layers.length} 个可编辑图层`);
      return;
    }
    if (cloudSplitAtlas.value) {
      // 图集超载拆分：先提示双倍积分，确认后再预扣第二张图集的费用。
      splitBaseCharge = chargeResult;
      splitConfirmOpen.value = true;
      return;
    }
    await createCloudBackgrounds([chargeResult]);
  }

  async function confirmSplitCloud() {
    splitConfirmOpen.value = false;
    if (!splitBaseCharge) return;
    const baseCharge = splitBaseCharge;
    splitBaseCharge = null;
    const splitCharge = await charge();
    if (!splitCharge) {
      await app.refundMatting(baseCharge.mattingId).catch(() => undefined);
      stage.value = "idle";
      return;
    }
    await createCloudBackgrounds([baseCharge, splitCharge]);
  }

  function cancelSplitCloud() {
    splitConfirmOpen.value = false;
    if (splitBaseCharge) {
      const baseCharge = splitBaseCharge;
      splitBaseCharge = null;
      void app.refundMatting(baseCharge.mattingId).catch(() => undefined);
    }
    stage.value = "idle";
  }

  async function retryCloudBackground() {
    if (!document.value || !cloudAtlas.value || busy.value) return;
    actionError.value = "";
    if (pendingSubmission) {
      // 网络歧义失败后重发：用原预扣与幂等键重新提交未绑定任务。
      await resubmitPendingSubmission();
      return;
    }
    const hasSplit = Boolean(cloudSplitAtlas.value);
    const backgroundOk = isSucceededTask(cloudTask.value);
    const splitOk = !hasSplit || isSucceededTask(cloudSplitTask.value);
    if (backgroundOk && splitOk) {
      try {
        stage.value = "waiting";
        await applyCloudOutputs();
        document.value = {
          ...document.value,
          status: "complete",
          cloudInputAssetId: cloudTask.value?.inputAssetId
        };
        stage.value = "complete";
        drawerOpen.value = true;
      } catch (error) {
        stage.value = "draft";
        actionError.value = error instanceof Error ? error.message : "云端背景图集拆分失败。";
      }
      return;
    }
    if (isPendingTask(cloudTask.value) || (hasSplit && isPendingTask(cloudSplitTask.value))) {
      // 已有任务在排队：等待完成后回填，成功部分直接采用。
      await waitAndApplyCloudTasks();
      return;
    }
    // 失败或缺失的任务重新提交：失败任务服务端已退款，需要新预扣。
    const charges: MattingChargeResult[] = [];
    const items: Array<{ atlas: AutoLayerRepairAtlas; isBackground: boolean; charge: MattingChargeResult }> = [];
    if (!backgroundOk) {
      const chargeResult = await charge();
      if (!chargeResult) return;
      charges.push(chargeResult);
      items.push({ atlas: cloudAtlas.value, isBackground: true, charge: chargeResult });
    }
    if (hasSplit && !splitOk) {
      const chargeResult = await charge();
      if (!chargeResult) {
        for (const charge of charges) {
          await app.refundMatting(charge.mattingId).catch(() => undefined);
        }
        return;
      }
      charges.push(chargeResult);
      items.push({ atlas: cloudSplitAtlas.value!, isBackground: false, charge: chargeResult });
    }
    await submitAndWaitCloudItems(items);
  }

  /** 用保留的预扣与幂等键重新提交网络歧义失败的未绑定任务。 */
  async function resubmitPendingSubmission() {
    const submission = pendingSubmission;
    if (!submission || !cloudAtlas.value || !document.value) return;
    pendingSubmission = null;
    const items = submission.map((entry, index) => ({
      atlas: index === 0 ? cloudAtlas.value! : cloudSplitAtlas.value!,
      isBackground: index === 0,
      charge: entry.charge,
      idempotencyKey: entry.idempotencyKey
    }));
    await submitAndWaitCloudItems(items);
  }

  /** 提交缺失任务、等待全部任务完成并回填成功输出。 */
  async function submitAndWaitCloudItems(
    items: Array<{ atlas: AutoLayerRepairAtlas; isBackground: boolean; charge: MattingChargeResult; idempotencyKey?: string }>
  ) {
    const abortController = controller.value ?? new AbortController();
    controller.value = abortController;
    drawerOpen.value = false;
    try {
      for (const item of items) {
        stage.value = "uploading";
        const task = await submitAtlasTask(
          item.atlas,
          item.isBackground,
          item.charge,
          item.idempotencyKey ?? `huanhua:${crypto.randomUUID()}`
        );
        if (item.isBackground) cloudTask.value = task;
        else cloudSplitTask.value = task;
      }
      await waitAndApplyCloudTasks();
    } finally {
      controller.value = null;
    }
  }

  /** 等待所有非终态任务，回填成功输出并收敛状态。 */
  async function waitAndApplyCloudTasks() {
    const currentDocument = document.value;
    if (!currentDocument) return;
    const abortController = controller.value ?? new AbortController();
    controller.value = abortController;
    try {
      const pendingTasks = [cloudTask.value, cloudSplitTask.value]
        .filter((task): task is AutoLayerTask => Boolean(task) && isPendingTask(task));
      if (pendingTasks.length) {
        stage.value = "waiting";
        const settled = await Promise.all(
          pendingTasks.map(task => app.waitForAutoLayerTask(task, abortController.signal)
            .catch(() => null))
        );
        for (const task of settled) {
          if (!task) continue;
          if (cloudTask.value?.id === task.id) cloudTask.value = task;
          if (cloudSplitTask.value?.id === task.id) cloudSplitTask.value = task;
        }
      }
      await applyCloudOutputs();
      const hasSplit = Boolean(cloudSplitAtlas.value);
      const allSucceeded = isSucceededTask(cloudTask.value) && (!hasSplit || isSucceededTask(cloudSplitTask.value));
      if (allSucceeded) {
        document.value = {
          ...currentDocument,
          status: "complete",
          cloudInputAssetId: cloudTask.value?.inputAssetId
        };
        stage.value = "complete";
        drawerOpen.value = true;
        showMessage(`已生成 ${currentDocument.layers.length} 个可编辑图层`);
      } else {
        document.value = { ...currentDocument, status: "draft" };
        stage.value = "draft";
        drawerOpen.value = false;
        actionError.value = "云端背景生成失败，可只重试背景。";
      }
    } finally {
      controller.value = null;
    }
  }

  async function savePackage() {
    if (!document.value || !selectedFile.value) return;
    try {
      const directory = await saveAutoLayerPackage(document.value, selectedFile.value.name);
      if (directory) showMessage("分层素材已打包保存");
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "分层素材保存失败。";
    }
  }

  async function saveSelections() {
    if (!selectedFile.value || !imageSource.value || !canSaveSelections.value) return;
    actionError.value = "";
    try {
      selectionRecords.value = await createAutoLayerSelectionRecord({
        selectedFile: selectedFile.value,
        sourceWidth: imageSource.value.width,
        sourceHeight: imageSource.value.height,
        selections: selections.value
      });
      showMessage("当前图片与选区已保存");
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "选区保存失败。";
    }
  }

  async function openSelectionHistory() {
    if (!isDesktopApp() || selectionHistoryLoading.value) return;
    selectionHistoryLoading.value = true;
    actionError.value = "";
    try {
      const result = await readAutoLayerSelectionRecords();
      selectionRecords.value = result.records;
      selectionHistoryOpen.value = true;
      if (result.removedCount) showMessage(`已清除 ${result.removedCount} 条原图不存在的记录`);
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "选区记录读取失败。";
    } finally {
      selectionHistoryLoading.value = false;
    }
  }

  async function restoreSelections(record: AutoLayerSelectionRecord) {
    if (busy.value) return;
    actionError.value = "";
    try {
      const restored = await restoreAutoLayerSelectionRecord(record);
      resetSession(restored.selectedFile, restored.selections);
      selectionHistoryOpen.value = false;
      showMessage(`已恢复 ${restored.selections.length} 个选区`);
    } catch (error) {
      selectionRecords.value = selectionRecords.value.filter(item => item.id !== record.id);
      actionError.value = error instanceof Error ? error.message : "选区恢复失败。";
    }
  }

  async function removeSelectionRecord(recordId: string) {
    try {
      selectionRecords.value = await removeAutoLayerSelectionRecord(recordId);
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "选区记录删除失败。";
    }
  }

  function cancel() {
    controller.value?.abort();
    inference.cancel();
  }

  function handleLoginSuccess() {
    showLogin.value = false;
    void createLayers();
  }

  onBeforeUnmount(() => {
    controller.value?.abort();
    if (messageTimer) window.clearTimeout(messageTimer);
  });

  void refreshRecognitionResource();

  return {
    app, inference, selectedFile, imageSource, selections, document, sessionKey,
    selecting, clearing, showLogin, drawerOpen, selectionHistoryOpen, selectionHistoryLoading,
    selectionRecords, stage, actionError, actionMessage, splitConfirmOpen,
    recognitionResourceStatus, recognitionResourceProgress,
    source, cost, enabled, busy, insufficientCredits, canPackage, desktopAvailable,
    canSaveSelections, progress,
    chooseImage, loadDroppedImage, clearImage, handleReady, handleSelectionsChange,
    updateLayers, createLayers, retryCloudBackground, savePackage, saveSelections,
    openSelectionHistory, restoreSelections, removeSelectionRecord, cancel, handleLoginSuccess,
    installRecognitionResource, confirmSplitCloud, cancelSplitCloud
  };
}
