import { computed, onBeforeUnmount, readonly, shallowRef } from "vue";
import type {
  CutoutModelStatus,
  CutoutResult,
  CutoutSelectionBox
} from "@/types";
import {
  CUTOUT_MODEL,
  downloadModel,
  getModelStatus,
  supportsLocalCutoutModels,
  type ModelDownloadProgress,
  type ModelInstallStage
} from "@/services/cutoutModelManager";
import {
  CUTOUT_REFINER,
  downloadRefiner,
  getRefinerStatus
} from "@/services/cutoutRefinerManager";
import {
  cancelInferenceRun,
  decodeCutoutBox,
  encodeCutoutImage,
  refineCutoutMask,
  releaseInferenceSession
} from "@/services/cutoutInference";
import { maskToTransparentPng } from "@/services/cutoutExport";

export type CutoutPhase = "idle" | "downloading" | "verifying" | "installing" | "processing";
export type CutoutResourceStatus = "checking" | CutoutModelStatus;

export interface CutoutResourceProgress {
  stage: ModelInstallStage;
  percent: number;
}

export interface CutoutProgress {
  current: number;
  total: number;
  stage: "segmenting" | "refining";
}

type ResourcePart = "segmenter" | "refiner";

interface PendingResourcePart {
  id: ResourcePart;
  sizeBytes: number;
  install: (
    onProgress: (progress: ModelDownloadProgress) => void,
    signal: AbortSignal
  ) => Promise<void>;
}

const INSTALL_STAGE_INDEX: Record<ModelInstallStage, number> = {
  downloading: 0,
  verifying: 1,
  installing: 2
};
const INSTALL_STAGE_COUNT = Object.keys(INSTALL_STAGE_INDEX).length;
const RESOURCE_DOWNLOAD_SIZE_BYTES = CUTOUT_MODEL.sizeBytes + CUTOUT_REFINER.sizeBytes;

/**
 * 管理统一抠图资源包与批量抠图。资源包由 ViT-H 和 ViTMatte 组成，
 * 一次安装只补齐缺失部分；一次推理只运行一次 encoder 并复用 embedding。
 */
export function useCutoutInference() {
  const phase = shallowRef<CutoutPhase>("idle");
  const segmenterStatus = shallowRef<CutoutModelStatus>("missing");
  const refinerStatus = shallowRef<CutoutModelStatus>("missing");
  const resourceStatusChecked = shallowRef(false);
  const resourceProgress = shallowRef<CutoutResourceProgress | null>(null);
  const progress = shallowRef<CutoutProgress | null>(null);
  const error = shallowRef("");
  const abortController = shallowRef<AbortController | null>(null);
  const localModelsSupported = supportsLocalCutoutModels();

  const resourceStatus = computed<CutoutResourceStatus>(() => {
    if (!resourceStatusChecked.value) return "checking";
    if (phase.value !== "idle" && phase.value !== "processing") return "downloading";
    if (segmenterStatus.value === "ready" && refinerStatus.value === "ready") {
      return "ready";
    }
    if (segmenterStatus.value === "error" || refinerStatus.value === "error") {
      return "error";
    }
    return "missing";
  });

  function setResourcePartStatus(part: ResourcePart, status: CutoutModelStatus) {
    if (part === "segmenter") segmenterStatus.value = status;
    else refinerStatus.value = status;
  }

  async function refreshResourceStatus() {
    try {
      const [nextSegmenterStatus, nextRefinerStatus] = await Promise.all([
        getModelStatus(CUTOUT_MODEL),
        getRefinerStatus(CUTOUT_REFINER)
      ]);
      segmenterStatus.value = nextSegmenterStatus;
      refinerStatus.value = nextRefinerStatus;
    } catch (exception) {
      segmenterStatus.value = "error";
      refinerStatus.value = "error";
      error.value = exception instanceof Error
        ? exception.message
        : "无法检查 AI 抠图资源包。";
    } finally {
      resourceStatusChecked.value = true;
    }
  }

  function updateResourceProgress(
    next: ModelDownloadProgress,
    partSizeBytes: number,
    completedWork: number,
    totalWork: number
  ) {
    const partRatio = next.totalBytes > 0
      ? Math.min(1, next.receivedBytes / next.totalBytes)
      : 0;
    const currentWork = (
      INSTALL_STAGE_INDEX[next.stage] + partRatio
    ) * partSizeBytes;
    resourceProgress.value = {
      stage: next.stage,
      percent: Math.min(100, Math.round((completedWork + currentWork) / totalWork * 100))
    };
    phase.value = next.stage;
  }

  async function installResourcePackage() {
    if (phase.value !== "idle") return false;
    error.value = "";
    if (!localModelsSupported) {
      error.value = "浏览器预览不能安装 AI 抠图资源包，请在桌面客户端中使用。";
      return false;
    }

    if (!resourceStatusChecked.value) await refreshResourceStatus();
    const pendingParts: PendingResourcePart[] = [];
    if (segmenterStatus.value !== "ready") {
      pendingParts.push({
        id: "segmenter",
        sizeBytes: CUTOUT_MODEL.sizeBytes,
        install: (onProgress, signal) => downloadModel(
          CUTOUT_MODEL,
          onProgress,
          signal
        )
      });
    }
    if (refinerStatus.value !== "ready") {
      pendingParts.push({
        id: "refiner",
        sizeBytes: CUTOUT_REFINER.sizeBytes,
        install: (onProgress, signal) => downloadRefiner(
          CUTOUT_REFINER,
          onProgress,
          signal
        )
      });
    }
    if (!pendingParts.length) return true;

    const controller = new AbortController();
    abortController.value = controller;
    phase.value = "downloading";
    resourceProgress.value = { stage: "downloading", percent: 0 };
    const totalWork = pendingParts.reduce(
      (sum, part) => sum + part.sizeBytes * INSTALL_STAGE_COUNT,
      0
    );
    let completedWork = 0;
    let activePart: PendingResourcePart | null = null;

    try {
      for (const part of pendingParts) {
        activePart = part;
        setResourcePartStatus(part.id, "downloading");
        await part.install(
          (next) => updateResourceProgress(
            next,
            part.sizeBytes,
            completedWork,
            totalWork
          ),
          controller.signal
        );
        completedWork += part.sizeBytes * INSTALL_STAGE_COUNT;
        setResourcePartStatus(part.id, "ready");
      }
      resourceProgress.value = { stage: "installing", percent: 100 };
      return true;
    } catch (exception) {
      if (activePart) {
        setResourcePartStatus(
          activePart.id,
          controller.signal.aborted ? "missing" : "error"
        );
      }
      error.value = controller.signal.aborted
        ? "资源包安装已取消。"
        : exception instanceof Error
          ? exception.message
          : "AI 抠图资源包安装失败。";
      return false;
    } finally {
      phase.value = "idle";
      resourceProgress.value = null;
      abortController.value = null;
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
    if (!selections.length) {
      error.value = "请先在画布上框选要抠取的元素。";
      return [];
    }

    phase.value = "processing";
    progress.value = { current: 1, total: selections.length, stage: "segmenting" };
    error.value = "";
    const controller = new AbortController();
    abortController.value = controller;
    const results: CutoutResult[] = [];

    try {
      const [nextSegmenterStatus, nextRefinerStatus] = await Promise.all([
        getModelStatus(CUTOUT_MODEL),
        getRefinerStatus(CUTOUT_REFINER)
      ]);
      segmenterStatus.value = nextSegmenterStatus;
      refinerStatus.value = nextRefinerStatus;
      resourceStatusChecked.value = true;
      if (nextSegmenterStatus !== "ready" || nextRefinerStatus !== "ready") {
        error.value = "请先下载完整的 AI 抠图资源包。";
        return [];
      }

      const embedding = await encodeCutoutImage(
        CUTOUT_MODEL,
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
        progress.value = {
          current: index + 1,
          total: selections.length,
          stage: "segmenting"
        };
        const mask = await decodeCutoutBox(
          CUTOUT_MODEL,
          embedding,
          selection,
          controller.signal
        );
        progress.value = {
          current: index + 1,
          total: selections.length,
          stage: "refining"
        };
        const refinedMask = await refineCutoutMask(
          CUTOUT_REFINER,
          image,
          imageWidth,
          imageHeight,
          mask,
          selection,
          controller.signal
        );
        const { blob, width, height, thumbnailUrl } = await maskToTransparentPng(
          image,
          imageWidth,
          imageHeight,
          refinedMask,
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
        progress.value = {
          current: results.length,
          total: selections.length,
          stage: "refining"
        };
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

  void refreshResourceStatus();

  onBeforeUnmount(() => {
    abortController.value?.abort();
    void releaseInferenceSession().catch(() => undefined);
  });

  return {
    phase: readonly(phase),
    resourceStatus,
    resourceProgress: readonly(resourceProgress),
    resourceDownloadSizeBytes: RESOURCE_DOWNLOAD_SIZE_BYTES,
    progress: readonly(progress),
    error: readonly(error),
    localModelsSupported,
    refreshResourceStatus,
    installResourcePackage,
    segmentSelections,
    cancel
  };
}
