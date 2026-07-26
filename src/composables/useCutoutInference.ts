import { computed, onBeforeUnmount, readonly, shallowRef } from "vue";
import type {
  CutoutModelDescriptor,
  CutoutModelStatus,
  CutoutResult,
  CutoutSelectionBox
} from "@/types";
import {
  CUTOUT_MODELS,
  downloadModel,
  getModelStatuses,
  removeModel,
  supportsLocalCutoutModels,
  type ModelDownloadProgress
} from "@/services/cutoutModelManager";
import {
  cancelInferenceRun,
  decodeCutoutBox,
  encodeCutoutImage,
  releaseInferenceSession
} from "@/services/cutoutInference";
import { maskToTransparentPng } from "@/services/cutoutExport";

export type CutoutPhase = "idle" | "downloading" | "verifying" | "installing" | "processing";

const initialStatuses = Object.fromEntries(
  CUTOUT_MODELS.map((model) => [model.id, "missing" as CutoutModelStatus])
);

/**
 * 管理逐模型安装状态与批量抠图。一次任务只运行一次 encoder，
 * 多个框选依次复用同一份 image embedding。
 */
export function useCutoutInference() {
  const phase = shallowRef<CutoutPhase>("idle");
  const activeModel = shallowRef<CutoutModelDescriptor>(
    CUTOUT_MODELS.find((model) => model.recommended) ?? CUTOUT_MODELS.at(-1)!
  );
  const modelStatuses = shallowRef<Record<string, CutoutModelStatus>>({
    ...initialStatuses
  });
  const downloadProgress = shallowRef<ModelDownloadProgress | null>(null);
  const progress = shallowRef<{ current: number; total: number } | null>(null);
  const error = shallowRef("");
  const abortController = shallowRef<AbortController | null>(null);
  const localModelsSupported = supportsLocalCutoutModels();

  const modelStatus = computed(
    () => modelStatuses.value[activeModel.value.id] ?? "missing"
  );

  function setModelStatus(modelId: string, status: CutoutModelStatus) {
    modelStatuses.value = { ...modelStatuses.value, [modelId]: status };
  }

  async function refreshModelStatuses() {
    modelStatuses.value = await getModelStatuses();
  }

  async function selectModel(descriptor: CutoutModelDescriptor) {
    if (phase.value !== "idle") return;
    const previousModelId = activeModel.value.id;
    if (previousModelId !== descriptor.id) {
      await releaseInferenceSession(previousModelId).catch(() => undefined);
    }
    activeModel.value = descriptor;
    error.value = "";
    const statuses = await getModelStatuses();
    modelStatuses.value = statuses;
  }

  async function installModel(descriptor: CutoutModelDescriptor) {
    if (phase.value !== "idle") return false;
    activeModel.value = descriptor;
    error.value = "";
    if (!localModelsSupported) {
      error.value = "浏览器预览不能安装本地模型，请在桌面客户端中使用。";
      return false;
    }

    const controller = new AbortController();
    abortController.value = controller;
    phase.value = "downloading";
    setModelStatus(descriptor.id, "downloading");
    downloadProgress.value = {
      stage: "downloading",
      receivedBytes: 0,
      totalBytes: descriptor.sizeBytes
    };
    try {
      await downloadModel(
        descriptor,
        (next) => {
          downloadProgress.value = next;
          phase.value = next.stage;
        },
        controller.signal
      );
      setModelStatus(descriptor.id, "ready");
      return true;
    } catch (exception) {
      setModelStatus(descriptor.id, controller.signal.aborted ? "missing" : "error");
      error.value = controller.signal.aborted
        ? "模型安装已取消。"
        : exception instanceof Error
          ? exception.message
          : "模型安装失败。";
      return false;
    } finally {
      phase.value = "idle";
      downloadProgress.value = null;
      abortController.value = null;
    }
  }

  async function uninstallModel(descriptor: CutoutModelDescriptor) {
    if (phase.value !== "idle") return;
    error.value = "";
    await releaseInferenceSession(descriptor.id);
    try {
      await removeModel(descriptor);
      setModelStatus(descriptor.id, "missing");
    } catch (exception) {
      setModelStatus(descriptor.id, "error");
      error.value = exception instanceof Error ? exception.message : "模型移除失败。";
    }
  }

  function cancel() {
    abortController.value?.abort();
    void cancelInferenceRun().catch(() => undefined);
  }

  async function segmentSelections(
    image: CanvasImageSource,
    imageWidth: number,
    imageHeight: number,
    selections: CutoutSelectionBox[],
    baseName: string,
    onResult: (result: CutoutResult) => void
  ): Promise<CutoutResult[]> {
    if (phase.value !== "idle") return [];
    const descriptor = activeModel.value;
    if (!selections.length) {
      error.value = "请先在画布上框选要抠取的元素。";
      return [];
    }

    phase.value = "processing";
    progress.value = { current: 0, total: selections.length };
    error.value = "";
    const controller = new AbortController();
    abortController.value = controller;
    const results: CutoutResult[] = [];

    try {
      const status = await getModelStatuses();
      modelStatuses.value = status;
      if (status[descriptor.id] !== "ready") {
        error.value = "请先下载当前抠图模型。";
        return [];
      }
      const embedding = await encodeCutoutImage(
        descriptor,
        image,
        imageWidth,
        imageHeight,
        controller.signal
      );
      for (let index = 0; index < selections.length; index += 1) {
        if (controller.signal.aborted) {
          throw new DOMException("抠图已取消。", "AbortError");
        }
        const selection = selections[index];
        progress.value = { current: index, total: selections.length };
        const mask = await decodeCutoutBox(
          descriptor,
          embedding,
          selection,
          controller.signal
        );
        const { blob, width, height, thumbnailUrl } = await maskToTransparentPng(
          image,
          imageWidth,
          imageHeight,
          mask,
          selection
        );
        const result: CutoutResult = {
          id: `${selection.id}-${Date.now()}-${index}`,
          blob,
          thumbnailUrl,
          width,
          height,
          sourceBox: selection,
          baseName: `${baseName}-cutout-${index + 1}`
        };
        results.push(result);
        onResult(result);
        progress.value = { current: results.length, total: selections.length };
      }
      return results;
    } catch (exception) {
      error.value = controller.signal.aborted
        ? "抠图已取消。"
        : exception instanceof Error
          ? exception.message
          : "抠图失败，请稍后重试。";
      return results;
    } finally {
      phase.value = "idle";
      progress.value = null;
      abortController.value = null;
    }
  }

  void refreshModelStatuses();

  onBeforeUnmount(() => {
    abortController.value?.abort();
    void releaseInferenceSession().catch(() => undefined);
  });

  return {
    phase: readonly(phase),
    activeModel: readonly(activeModel),
    modelStatuses: readonly(modelStatuses),
    modelStatus,
    downloadProgress: readonly(downloadProgress),
    progress: readonly(progress),
    error: readonly(error),
    localModelsSupported,
    selectModel,
    refreshModelStatuses,
    installModel,
    uninstallModel,
    segmentSelections,
    cancel
  };
}
