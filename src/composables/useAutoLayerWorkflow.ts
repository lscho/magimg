import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import type { AutoLayerDocument, AutoLayerItem } from "@/components/auto-layer/types";
import {
  useCutoutInference,
  type AutoLayerInferenceResult
} from "@/composables/useCutoutInference";
import { ApiError } from "@/services/apiClient";
import { compositeAutoLayerCloudOutput } from "@/services/autoLayerCloudComposite";
import {
  autoLayerUploadFileName,
  prepareAutoLayerCloudUpload,
  type PreparedAutoLayerCloudUpload
} from "@/services/autoLayerCloudUpload";
import { createAutoLayerItems, orderAutoLayersByHierarchy } from "@/services/autoLayerModel";
import { saveAutoLayerPackage } from "@/services/autoLayerExport";
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
type AutoLayerCloudBackground = NonNullable<AutoLayerInferenceResult["cloudBackground"]>;
type CloudUploadPreparation =
  | { result: PreparedAutoLayerCloudUpload; error?: never }
  | { result?: never; error: Error };

function isSucceededTask(task: AutoLayerTask | null): task is AutoLayerTask {
  return task?.status === "succeeded" && Boolean(task.outputUrl);
}

function isPendingTask(task: AutoLayerTask | null) {
  return task?.status === "pending" || task?.status === "processing";
}

function cloudTaskErrorMessage(task: AutoLayerTask | null) {
  if (task?.errorMessage) return task.errorMessage;
  return task?.status === "canceled" ? "自动分层云端背景已取消。" : "云端背景生成失败，可重试背景。";
}

export function useAutoLayerWorkflow() {
  const app = useAppStore();
  const inference = useCutoutInference();
  const selectedFile = shallowRef<SelectedImageFile | null>(null);
  const imageSource = shallowRef<{ source: CanvasImageSource; width: number; height: number } | null>(null);
  const selections = shallowRef<CutoutSelection[]>([]);
  const document = shallowRef<AutoLayerDocument | null>(null);
  const cloudBackground = shallowRef<AutoLayerCloudBackground | null>(null);
  const cloudTask = shallowRef<AutoLayerTask | null>(null);
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
  let pendingSubmission: { charge: MattingChargeResult; idempotencyKey: string } | null = null;
  let cloudUploadPreparation: Promise<CloudUploadPreparation> | null = null;

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
      return true;
    } catch (error) {
      recognitionResourceStatus.value = "error";
      actionError.value = error instanceof Error ? error.message : "识别资源安装失败。";
      return false;
    } finally {
      controller.value = null;
    }
  }

  async function installMissingResources(): Promise<boolean> {
    if (busy.value || inference.resourceStatus.value === "downloading") return false;
    actionError.value = "";
    const installers: Promise<boolean>[] = [];
    if (inference.resourceStatus.value !== "ready") {
      installers.push(inference.installResourcePackage());
    }
    if (recognitionResourceStatus.value !== "ready") {
      installers.push(installRecognitionResource());
    }
    if (!installers.length) return true;
    const installed = await Promise.all(installers);
    const ready = installed.every(Boolean)
      && inference.resourceStatus.value === "ready"
      && recognitionResourceStatus.value === "ready";
    if (ready) showMessage("自动分层资源已就绪");
    return ready;
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
    cloudBackground.value = null;
    cloudTask.value = null;
    cloudUploadPreparation = null;
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
      cloudBackground.value = null;
      cloudTask.value = null;
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

  async function submitCloudBackgroundTask(
    input: AutoLayerCloudBackground,
    chargeResult: MattingChargeResult,
    idempotencyKey: string
  ) {
    const documentValue = document.value;
    if (!documentValue) throw new Error("分层文档不存在。");
    const prepared = documentValue.cloudInputAssetId || !cloudUploadPreparation
      ? null
      : await cloudUploadPreparation;
    if (prepared?.error) throw prepared.error;
    const uploadBlob = prepared?.result.blob ?? input.imageBlob;
    return app.createAutoLayerTask({
      image: documentValue.cloudInputAssetId
        ? undefined
        : new File([uploadBlob], autoLayerUploadFileName(uploadBlob), {
          type: uploadBlob.type || "image/png"
        }),
      inputAssetId: documentValue.cloudInputAssetId,
      selectionBoxes: input.selectionBoxes,
      mattingId: chargeResult.mattingId,
      idempotencyKey
    });
  }

  async function applyCloudOutput() {
    if (!document.value || !isSucceededTask(cloudTask.value)) return;
    const input = cloudBackground.value;
    if (!input) throw new Error("云端背景输入不存在。");
    const repairedBlob = await app.downloadAutoLayerOutput(cloudTask.value);
    const backgroundBlob = await compositeAutoLayerCloudOutput(
      input.imageBlob,
      repairedBlob,
      document.value.width,
      document.value.height,
      input.selectionBoxes
    );
    document.value = {
      ...document.value,
      backgroundBlob
    };
  }

  async function createCloudBackground(chargeResult: MattingChargeResult) {
    const input = cloudBackground.value;
    if (!input || !document.value) return;
    const abortController = controller.value ?? new AbortController();
    controller.value = abortController;
    const idempotencyKey = `huanhua:${crypto.randomUUID()}`;
    let accepted = false;
    pendingSubmission = { charge: chargeResult, idempotencyKey };
    drawerOpen.value = false;
    try {
      stage.value = "uploading";
      cloudTask.value = await submitCloudBackgroundTask(input, chargeResult, idempotencyKey);
      accepted = true;
      pendingSubmission = null;
      stage.value = "waiting";
      cloudTask.value = await app.waitForAutoLayerTask(cloudTask.value, abortController.signal);
      if (!isSucceededTask(cloudTask.value)) throw new Error(cloudTaskErrorMessage(cloudTask.value));
      await applyCloudOutput();
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
        if (!cloudTask.value) await app.refundMatting(chargeResult.mattingId).catch(() => undefined);
      }
    } finally {
      controller.value = null;
    }
  }

  async function createLayers() {
    if (!app.isAuthenticated) { showLogin.value = true; return; }
    if (!enabled.value) { actionError.value = "服务端尚未启用自动分层。"; return; }
    const image = imageSource.value;
    if (!image || busy.value) return;
    if (!selections.value.length) { actionError.value = "请先框选元素或文字。"; return; }
    actionError.value = "";
    const chargeResult = await charge();
    if (!chargeResult) return;
    document.value = null;
    cloudBackground.value = null;
    cloudTask.value = null;
    controller.value = new AbortController();
    stage.value = "local";
    const cloudSourceBlob = selectedFile.value?.file;
    cloudUploadPreparation = cloudSourceBlob
      ? prepareAutoLayerCloudUpload(
        cloudSourceBlob,
        app.capabilities.backgroundRepairMaxBytes
      ).then(
        result => ({ result }),
        error => ({ error: error instanceof Error ? error : new Error("整页背景压缩失败。") })
      )
      : null;
    const output = await inference.createAutoLayers(
      image.source,
      image.width,
      image.height,
      cloneCutoutSelections(selections.value),
      {
        cloudMaxPixels: app.capabilities.backgroundRepairMaxPixels,
        cloudMaxBytes: app.capabilities.backgroundRepairMaxBytes,
        ...(cloudSourceBlob ? { cloudSourceBlob } : {})
      }
    );
    if (!output) {
      stage.value = "idle";
      cloudUploadPreparation = null;
      await app.refundMatting(chargeResult.mattingId).catch(() => undefined);
      controller.value = null;
      return;
    }
    cloudBackground.value = output.cloudBackground ?? null;
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
    if (!cloudBackground.value) {
      // 纯色/渐变背景已在本地直接提取，无云端任务：退还预扣积分并完成分层。
      await app.refundMatting(chargeResult.mattingId).catch(() => undefined);
      document.value = { ...document.value, status: "complete" };
      stage.value = "complete";
      drawerOpen.value = true;
      controller.value = null;
      cloudUploadPreparation = null;
      showMessage(`已生成 ${document.value.layers.length} 个可编辑图层`);
      return;
    }
    await createCloudBackground(chargeResult);
  }

  async function retryCloudBackground() {
    if (!document.value || !cloudBackground.value || busy.value) return;
    actionError.value = "";
    if (pendingSubmission) {
      // 网络歧义失败后重发：用原预扣与幂等键重新提交未绑定任务。
      await resubmitPendingSubmission();
      return;
    }
    const backgroundOk = isSucceededTask(cloudTask.value);
    if (backgroundOk) {
      try {
        stage.value = "waiting";
        await applyCloudOutput();
        document.value = {
          ...document.value,
          status: "complete",
          cloudInputAssetId: cloudTask.value?.inputAssetId
        };
        stage.value = "complete";
        drawerOpen.value = true;
      } catch (error) {
        stage.value = "draft";
        actionError.value = error instanceof Error ? error.message : "云端背景读取失败。";
      }
      return;
    }
    if (isPendingTask(cloudTask.value)) {
      await waitAndApplyCloudTask();
      return;
    }
    const chargeResult = await charge();
    if (chargeResult) await createCloudBackground(chargeResult);
  }

  /** 用保留的预扣与幂等键重新提交网络歧义失败的未绑定任务。 */
  async function resubmitPendingSubmission() {
    const submission = pendingSubmission;
    const input = cloudBackground.value;
    if (!submission || !input || !document.value) return;
    const abortController = controller.value ?? new AbortController();
    controller.value = abortController;
    drawerOpen.value = false;
    try {
      stage.value = "uploading";
      cloudTask.value = await submitCloudBackgroundTask(
        input,
        submission.charge,
        submission.idempotencyKey
      );
      pendingSubmission = null;
      await waitAndApplyCloudTask();
    } catch (error) {
      const ambiguousNetworkFailure = error instanceof ApiError && error.statusCode === 0;
      pendingSubmission = ambiguousNetworkFailure ? submission : null;
      document.value = { ...document.value, status: "draft" };
      stage.value = "draft";
      drawerOpen.value = false;
      actionError.value = error instanceof Error ? error.message : "云端背景任务提交失败。";
      if (!ambiguousNetworkFailure && !cloudTask.value) {
        await app.refundMatting(submission.charge.mattingId).catch(() => undefined);
      }
    } finally {
      controller.value = null;
    }
  }

  /** 等待整页背景任务，回填输出并收敛状态。 */
  async function waitAndApplyCloudTask() {
    if (!document.value) return;
    const abortController = controller.value ?? new AbortController();
    controller.value = abortController;
    try {
      if (cloudTask.value && isPendingTask(cloudTask.value)) {
        stage.value = "waiting";
        cloudTask.value = await app.waitForAutoLayerTask(cloudTask.value, abortController.signal);
      }
      if (!isSucceededTask(cloudTask.value)) throw new Error(cloudTaskErrorMessage(cloudTask.value));
      await applyCloudOutput();
      const appliedDocument = document.value;
      if (!appliedDocument) return;
      document.value = {
        ...appliedDocument,
        status: "complete",
        cloudInputAssetId: cloudTask.value.inputAssetId
      };
      stage.value = "complete";
      drawerOpen.value = true;
      showMessage(`已生成 ${appliedDocument.layers.length} 个可编辑图层`);
    } catch (error) {
      document.value = { ...document.value, status: "draft" };
      stage.value = "draft";
      drawerOpen.value = false;
      actionError.value = error instanceof Error ? error.message : "云端背景生成失败，可只重试背景。";
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
    selectionRecords, stage, actionError, actionMessage,
    recognitionResourceStatus, recognitionResourceProgress,
    source, cost, enabled, busy, insufficientCredits, canPackage, desktopAvailable,
    canSaveSelections, progress,
    chooseImage, loadDroppedImage, clearImage, handleReady, handleSelectionsChange,
    updateLayers, createLayers, retryCloudBackground, savePackage, saveSelections,
    openSelectionHistory, restoreSelections, removeSelectionRecord, cancel, handleLoginSuccess,
    installMissingResources
  };
}
