import { computed, onBeforeUnmount, readonly, shallowRef } from "vue";
import type {
  CutoutModelStatus,
  CutoutRepairMode,
  CutoutResult,
  CutoutSelection,
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
  downloadRepairModel,
  getRepairModelStatus
} from "@/services/cutoutRepairModelManager";
import {
  cancelInferenceRun,
  decodeCutoutBox,
  decodeCutoutCandidates,
  encodeCutoutImage,
  refineCutoutMask,
  releaseInferenceSession
} from "@/services/cutoutInference";
import { maskToTransparentPng } from "@/services/cutoutExport";
import {
  buildHighRecallChildMask,
  buildRemovalMask,
  chooseSmartRemovalCandidate,
  maskContainment,
  prepareRepairMask,
  sampleStrokePoints
} from "@/services/cutoutRepairMask";
import { shouldForceManualDiffusion } from "@/services/cutoutRepairContext";
import {
  compositeRepairedImage,
  repairBackgroundLocally
} from "@/services/cutoutBackgroundRepair";
import { maskArea, unionMasks } from "@/services/cutoutLayering";
import { chooseSingleElementMaskCandidate } from "@/services/cutoutMaskCandidate";
import {
  cloneCutoutSelections,
  selectionChildren
} from "@/services/cutoutSelectionModel";

export type CutoutPhase = "idle" | "downloading" | "verifying" | "installing" | "processing";
export type CutoutResourceStatus = "checking" | CutoutModelStatus;

export interface CutoutResourceProgress {
  stage: ModelInstallStage;
  percent: number;
}

export interface CutoutProgress {
  current: number;
  total: number;
  stage: "segmenting" | "refining" | "repairing" | "uploading" | "waiting";
}

export interface CutoutCloudRepairContext {
  setStage: (stage: "uploading" | "waiting") => void;
  signal: AbortSignal;
}

export interface CutoutSegmentationOptions {
  repairMode: CutoutRepairMode;
  cloudRepair?: (
    mask: Uint8Array,
    selectionBoxes: readonly CutoutSelectionBox[],
    context: CutoutCloudRepairContext
  ) => Promise<CanvasImageSource>;
  onSelectionsResolved?: (selections: CutoutSelection[]) => void;
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
const MIN_ALPHA_CONTAINMENT = 0.7;

export interface AutoLayerMaterial {
  id: string;
  blob: Blob;
  width: number;
  height: number;
  sourceBox: CutoutSelectionBox;
}

export interface AutoLayerInferenceResult {
  backgroundBlob: Blob;
  materials: AutoLayerMaterial[];
}

function abortError() {
  return new DOMException("抠图已取消。", "AbortError");
}

function hasMask(mask: Uint8Array) {
  return maskArea(mask) > 0;
}

function canvasToPngBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("分层背景导出失败。")),
      "image/png"
    );
  });
}

function expandedRepairBox(
  box: CutoutSelectionBox,
  imageWidth: number,
  imageHeight: number
): CutoutSelectionBox {
  const padding = Math.max(12, Math.round(Math.max(box.width, box.height) * 0.18));
  const x = Math.max(0, Math.round(box.x) - padding);
  const y = Math.max(0, Math.round(box.y) - padding);
  const right = Math.min(imageWidth, Math.round(box.x + box.width) + padding);
  const bottom = Math.min(imageHeight, Math.round(box.y + box.height) + padding);
  return {
    id: box.id,
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y)
  };
}

/**
 * 管理 SAM、ViTMatte 与按需下载的 Big-LaMa。所有选区复用一次 encoder；
 * 前景沿用原有框选链路，背景只在合并移除蒙版后进入修复模型。
 */
export function useCutoutInference() {
  const phase = shallowRef<CutoutPhase>("idle");
  const segmenterStatus = shallowRef<CutoutModelStatus>("missing");
  const refinerStatus = shallowRef<CutoutModelStatus>("missing");
  const repairStatus = shallowRef<CutoutModelStatus>("missing");
  const resourceStatusChecked = shallowRef(false);
  const repairStatusChecked = shallowRef(false);
  const resourceProgress = shallowRef<CutoutResourceProgress | null>(null);
  const repairProgress = shallowRef<CutoutResourceProgress | null>(null);
  const progress = shallowRef<CutoutProgress | null>(null);
  const error = shallowRef("");
  const abortController = shallowRef<AbortController | null>(null);
  const localModelsSupported = supportsLocalCutoutModels();

  const resourceStatus = computed<CutoutResourceStatus>(() => {
    if (!resourceStatusChecked.value) return "checking";
    if (segmenterStatus.value === "downloading" || refinerStatus.value === "downloading") {
      return "downloading";
    }
    if (segmenterStatus.value === "ready" && refinerStatus.value === "ready") return "ready";
    if (segmenterStatus.value === "error" || refinerStatus.value === "error") return "error";
    return "missing";
  });

  const repairResourceStatus = computed<CutoutResourceStatus>(() => {
    if (!repairStatusChecked.value) return "checking";
    return repairStatus.value;
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
      error.value = exception instanceof Error ? exception.message : "无法检查 AI 抠图资源包。";
    } finally {
      resourceStatusChecked.value = true;
    }
  }

  async function refreshRepairResourceStatus() {
    try {
      repairStatus.value = await getRepairModelStatus();
    } catch (exception) {
      repairStatus.value = "error";
      error.value = exception instanceof Error ? exception.message : "无法检查背景修复模型。";
    } finally {
      repairStatusChecked.value = true;
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
    const currentWork = (INSTALL_STAGE_INDEX[next.stage] + partRatio) * partSizeBytes;
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
        install: (onProgress, signal) => downloadModel(CUTOUT_MODEL, onProgress, signal)
      });
    }
    if (refinerStatus.value !== "ready") {
      pendingParts.push({
        id: "refiner",
        sizeBytes: CUTOUT_REFINER.sizeBytes,
        install: (onProgress, signal) => downloadRefiner(CUTOUT_REFINER, onProgress, signal)
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
          (next) => updateResourceProgress(next, part.sizeBytes, completedWork, totalWork),
          controller.signal
        );
        completedWork += part.sizeBytes * INSTALL_STAGE_COUNT;
        setResourcePartStatus(part.id, "ready");
      }
      resourceProgress.value = { stage: "installing", percent: 100 };
      return true;
    } catch (exception) {
      if (activePart) {
        setResourcePartStatus(activePart.id, controller.signal.aborted ? "missing" : "error");
      }
      error.value = controller.signal.aborted
        ? "资源包安装已取消。"
        : exception instanceof Error ? exception.message : "AI 抠图资源包安装失败。";
      return false;
    } finally {
      phase.value = "idle";
      resourceProgress.value = null;
      abortController.value = null;
    }
  }

  async function installRepairResource() {
    if (phase.value !== "idle") return false;
    error.value = "";
    if (!localModelsSupported) {
      error.value = "浏览器预览不能安装背景修复模型，请在桌面客户端中使用。";
      return false;
    }
    if (!repairStatusChecked.value) await refreshRepairResourceStatus();
    if (repairStatus.value === "ready") return true;
    const controller = new AbortController();
    abortController.value = controller;
    repairStatus.value = "downloading";
    phase.value = "downloading";
    repairProgress.value = { stage: "downloading", percent: 0 };
    try {
      await downloadRepairModel((next) => {
        phase.value = next.stage;
        repairProgress.value = {
          stage: next.stage,
          percent: next.totalBytes > 0
            ? Math.min(100, Math.round(next.receivedBytes / next.totalBytes * 100))
            : 0
        };
      }, controller.signal);
      repairStatus.value = "ready";
      return true;
    } catch (exception) {
      repairStatus.value = controller.signal.aborted ? "missing" : "error";
      error.value = controller.signal.aborted
        ? "背景修复模型安装已取消。"
        : exception instanceof Error ? exception.message : "背景修复模型安装失败。";
      return false;
    } finally {
      phase.value = "idle";
      repairProgress.value = null;
      abortController.value = null;
    }
  }

  function cancel() {
    abortController.value?.abort();
    void cancelInferenceRun().catch(() => undefined);
  }

  function validateAutomaticRelations(
    selections: CutoutSelection[],
    masks: ReadonlyMap<string, Uint8Array>
  ) {
    const resolved = cloneCutoutSelections(selections);
    for (const child of resolved) {
      if (!child.parentId || child.relationSource !== "auto") continue;
      const childMask = masks.get(child.id);
      const parentMask = masks.get(child.parentId);
      if (!childMask || !parentMask ||
        maskContainment(childMask, parentMask) < MIN_ALPHA_CONTAINMENT) {
        child.parentId = null;
        child.behavior = "extract";
        child.relationSource = "manual";
      }
    }
    for (const selection of resolved) {
      if (selection.relationSource === "auto") {
        selection.behavior = resolved.some((item) => item.parentId === selection.id)
          ? "background"
          : "extract";
      }
    }
    return resolved;
  }

  async function segmentSelections(
    image: CanvasImageSource,
    imageWidth: number,
    imageHeight: number,
    inputSelections: CutoutSelection[],
    baseName: string,
    onResult: (result: CutoutResult) => void,
    options: CutoutSegmentationOptions
  ): Promise<CutoutResult[]> {
    if (phase.value !== "idle") return [];
    if (!inputSelections.length) {
      error.value = "请先在画布上框选要抠取的元素。";
      return [];
    }

    phase.value = "processing";
    progress.value = { current: 1, total: inputSelections.length, stage: "segmenting" };
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
        throw new Error("请先下载完整的 AI 抠图资源包。");
      }

      const selections = cloneCutoutSelections(inputSelections);
      const embedding = await encodeCutoutImage(
        CUTOUT_MODEL,
        image,
        imageWidth,
        imageHeight,
        controller.signal
      );
      const coarseMasks = new Map<string, Uint8Array>();
      const refinedMasks = new Map<string, Uint8Array>();
      const optimizeSingleElement = selections.length === 1 &&
        selections[0].behavior === "extract" &&
        !selections[0].parentId;
      for (let index = 0; index < selections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const selection = selections[index];
        progress.value = { current: index + 1, total: selections.length, stage: "segmenting" };
        let mask: Uint8Array;
        if (optimizeSingleElement) {
          const candidates = await decodeCutoutCandidates(
            CUTOUT_MODEL,
            embedding,
            { box: selection },
            controller.signal
          );
          const candidate = chooseSingleElementMaskCandidate(candidates);
          if (!candidate) throw new Error("SAM 2.1 未返回可用的主体遮罩。");
          mask = candidate.alpha;
        } else {
          mask = await decodeCutoutBox(
            CUTOUT_MODEL,
            embedding,
            selection,
            controller.signal
          );
        }
        coarseMasks.set(selection.id, mask);
        progress.value = { current: index + 1, total: selections.length, stage: "refining" };
        refinedMasks.set(selection.id, await refineCutoutMask(
          CUTOUT_REFINER,
          image,
          imageWidth,
          imageHeight,
          mask,
          selection,
          controller.signal
        ));
      }

      const resolvedSelections = validateAutomaticRelations(selections, refinedMasks);
      options.onSelectionsResolved?.(cloneCutoutSelections(resolvedSelections));
      const foregroundSelections = resolvedSelections.filter(
        (selection) => selection.behavior === "extract"
      );
      for (let index = 0; index < foregroundSelections.length; index += 1) {
        const selection = foregroundSelections[index];
        const alpha = refinedMasks.get(selection.id);
        if (!alpha) continue;
        const exported = await maskToTransparentPng(
          image,
          imageWidth,
          imageHeight,
          alpha,
          selection
        );
        const result: CutoutResult = {
          id: `${selection.id}-${Date.now()}-${index}`,
          ...exported,
          sourceBox: selection,
          sourceSelectionId: selection.id,
          kind: "foreground",
          baseName: `${baseName}-cutout-${index + 1}`
        };
        results.push(result);
        onResult(result);
      }

      const backgroundSelections = resolvedSelections.filter(
        (selection) => selection.behavior === "background"
      );
      const repairMasks = new Map<string, Uint8Array>();
      for (let index = 0; index < backgroundSelections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const parent = backgroundSelections[index];
        const parentAlpha = refinedMasks.get(parent.id);
        if (!parentAlpha) continue;
        const smartMasks = new Map<string, Uint8Array>();
        for (const stroke of parent.removalStrokes) {
          if (!stroke.smart || stroke.operation !== "add") continue;
          const points = sampleStrokePoints(stroke);
          const candidates = await decodeCutoutCandidates(
            CUTOUT_MODEL,
            embedding,
            {
              box: parent,
              points: points.map((point) => ({ ...point, label: 1 as const }))
            },
            controller.signal
          );
          const candidate = chooseSmartRemovalCandidate(
            candidates,
            points,
            imageWidth,
            imageHeight,
            parent
          );
          if (candidate) smartMasks.set(stroke.id, candidate);
        }
        const childAlphas = selectionChildren(resolvedSelections, parent.id)
          .map((child) => {
            const refinedAlpha = refinedMasks.get(child.id);
            const coarseAlpha = coarseMasks.get(child.id);
            return refinedAlpha && coarseAlpha
              ? buildHighRecallChildMask({
                refinedAlpha,
                coarseAlpha,
                width: imageWidth,
                height: imageHeight,
                child
              })
              : refinedAlpha;
          })
          .filter((mask): mask is Uint8Array => Boolean(mask));
        const combined = buildRemovalMask({
          width: imageWidth,
          height: imageHeight,
          parent,
          parentAlpha,
          childAlphas,
          strokes: parent.removalStrokes,
          smartMasks
        });
        repairMasks.set(
          parent.id,
          hasMask(combined)
            ? prepareRepairMask(combined, imageWidth, imageHeight, parent)
            : combined
        );
      }

      const cloudBackgroundSelections = backgroundSelections.filter((selection) => {
        const mask = repairMasks.get(selection.id);
        return Boolean(mask && hasMask(mask));
      });
      const nonEmptyRepairMasks = cloudBackgroundSelections
        .map((selection) => repairMasks.get(selection.id))
        .filter((mask): mask is Uint8Array => Boolean(mask));
      if (nonEmptyRepairMasks.length) {
        await releaseInferenceSession(CUTOUT_MODEL.id);
      }
      let cloudRepairedSource: CanvasImageSource | null = null;
      if (options.repairMode === "cloud" && nonEmptyRepairMasks.length) {
        if (!options.cloudRepair) throw new Error("云端背景修复服务当前不可用。");
        const cloudRepairMask = unionMasks(nonEmptyRepairMasks);
        progress.value = { current: 1, total: 1, stage: "uploading" };
        const repairedResponse = await options.cloudRepair(
          cloudRepairMask,
          cloudBackgroundSelections,
          {
            signal: controller.signal,
            setStage: (stage) => {
              progress.value = { current: 1, total: 1, stage };
            }
          }
        );
        try {
          cloudRepairedSource = compositeRepairedImage(
            image,
            repairedResponse,
            cloudRepairMask,
            imageWidth,
            imageHeight
          );
        } finally {
          if (typeof ImageBitmap !== "undefined" && repairedResponse instanceof ImageBitmap) {
            repairedResponse.close();
          }
        }
      }

      for (let index = 0; index < backgroundSelections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const selection = backgroundSelections[index];
        const parentAlpha = refinedMasks.get(selection.id);
        const repairMask = repairMasks.get(selection.id);
        if (!parentAlpha || !repairMask) continue;
        progress.value = {
          current: index + 1,
          total: backgroundSelections.length,
          stage: "repairing"
        };
        let repairedSource: CanvasImageSource = image;
        if (hasMask(repairMask)) {
          if (options.repairMode === "local") {
            const nextRepairStatus = await getRepairModelStatus();
            repairStatus.value = nextRepairStatus;
            repairStatusChecked.value = true;
            if (nextRepairStatus !== "ready") {
              throw new Error("请先下载本地背景修复模型。");
            }
            repairedSource = await repairBackgroundLocally(
              image,
              imageWidth,
              imageHeight,
              repairMask,
              parentAlpha,
              selection,
              {
                signal: controller.signal,
                forceDiffusion: shouldForceManualDiffusion(
                  selection,
                  selectionChildren(resolvedSelections, selection.id).length > 0
                )
              }
            );
          } else if (cloudRepairedSource) {
            repairedSource = cloudRepairedSource;
          }
        }
        const exported = await maskToTransparentPng(
          repairedSource,
          imageWidth,
          imageHeight,
          parentAlpha,
          selection
        );
        const result: CutoutResult = {
          id: `${selection.id}-${Date.now()}-background-${index}`,
          ...exported,
          sourceBox: selection,
          sourceSelectionId: selection.id,
          kind: "background",
          repairMode: options.repairMode,
          baseName: `${baseName}-background-${index + 1}`
        };
        results.push(result);
        onResult(result);
      }
      return results;
    } catch (exception) {
      error.value = controller.signal.aborted
        ? "抠图已取消。"
        : exception instanceof Error
          ? exception.message
          : typeof exception === "string" && exception.trim()
            ? exception.trim()
            : "抠图失败，请稍后重试。";
      return results;
    } finally {
      phase.value = "idle";
      progress.value = null;
      abortController.value = null;
    }
  }

  async function createAutoLayers(
    image: CanvasImageSource,
    imageWidth: number,
    imageHeight: number,
    inputSelections: CutoutSelection[],
    onMaterial?: (material: AutoLayerMaterial) => void
  ): Promise<AutoLayerInferenceResult | null> {
    if (phase.value !== "idle") return null;
    if (!inputSelections.length) {
      error.value = "请先在左侧原图上框选要分层的内容。";
      return null;
    }

    phase.value = "processing";
    progress.value = { current: 1, total: inputSelections.length, stage: "segmenting" };
    error.value = "";
    const controller = new AbortController();
    abortController.value = controller;
    const materials: AutoLayerMaterial[] = [];

    try {
      const [nextSegmenterStatus, nextRefinerStatus, nextRepairStatus] = await Promise.all([
        getModelStatus(CUTOUT_MODEL),
        getRefinerStatus(CUTOUT_REFINER),
        getRepairModelStatus()
      ]);
      segmenterStatus.value = nextSegmenterStatus;
      refinerStatus.value = nextRefinerStatus;
      repairStatus.value = nextRepairStatus;
      resourceStatusChecked.value = true;
      repairStatusChecked.value = true;
      if (nextSegmenterStatus !== "ready" || nextRefinerStatus !== "ready") {
        throw new Error("请先下载完整的 AI 抠图资源包。");
      }
      if (nextRepairStatus !== "ready") {
        throw new Error("请先下载本地背景修复模型。");
      }

      const selections = cloneCutoutSelections(inputSelections).map((selection) => ({
        ...selection,
        behavior: "extract" as const,
        parentId: null,
        relationSource: "manual" as const,
        removalStrokes: []
      }));
      const embedding = await encodeCutoutImage(
        CUTOUT_MODEL,
        image,
        imageWidth,
        imageHeight,
        controller.signal
      );
      const removalMasks: Array<{ selection: CutoutSelection; alpha: Uint8Array }> = [];

      for (let index = 0; index < selections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const selection = selections[index];
        progress.value = { current: index + 1, total: selections.length, stage: "segmenting" };
        const candidates = await decodeCutoutCandidates(
          CUTOUT_MODEL,
          embedding,
          { box: selection },
          controller.signal
        );
        const candidate = chooseSingleElementMaskCandidate(candidates);
        if (!candidate) throw new Error("SAM 2.1 未返回可用的分层遮罩。");

        progress.value = { current: index + 1, total: selections.length, stage: "refining" };
        const refinedAlpha = await refineCutoutMask(
          CUTOUT_REFINER,
          image,
          imageWidth,
          imageHeight,
          candidate.alpha,
          selection,
          controller.signal
        );
        const exported = await maskToTransparentPng(
          image,
          imageWidth,
          imageHeight,
          refinedAlpha,
          selection
        );
        const material: AutoLayerMaterial = {
          id: selection.id,
          blob: exported.blob,
          width: exported.width,
          height: exported.height,
          sourceBox: { ...selection }
        };
        materials.push(material);
        onMaterial?.(material);
        removalMasks.push({
          selection,
          alpha: prepareRepairMask(buildHighRecallChildMask({
            refinedAlpha,
            coarseAlpha: candidate.alpha,
            width: imageWidth,
            height: imageHeight,
            child: selection
          }), imageWidth, imageHeight)
        });
      }

      await releaseInferenceSession(CUTOUT_MODEL.id);
      const fullAlpha = new Uint8Array(imageWidth * imageHeight);
      fullAlpha.fill(255);
      let repairedSource: CanvasImageSource = image;
      for (let index = 0; index < removalMasks.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const current = removalMasks[index];
        progress.value = { current: index + 1, total: removalMasks.length, stage: "repairing" };
        repairedSource = await repairBackgroundLocally(
          repairedSource,
          imageWidth,
          imageHeight,
          current.alpha,
          fullAlpha,
          expandedRepairBox(current.selection, imageWidth, imageHeight),
          { signal: controller.signal }
        );
      }

      const backgroundCanvas = document.createElement("canvas");
      backgroundCanvas.width = imageWidth;
      backgroundCanvas.height = imageHeight;
      const context = backgroundCanvas.getContext("2d");
      if (!context) throw new Error("当前设备无法合成分层背景。");
      context.drawImage(repairedSource, 0, 0, imageWidth, imageHeight);
      return {
        backgroundBlob: await canvasToPngBlob(backgroundCanvas),
        materials
      };
    } catch (exception) {
      error.value = controller.signal.aborted
        ? "自动分层已取消。"
        : exception instanceof Error
          ? exception.message
          : "自动分层失败，请稍后重试。";
      return null;
    } finally {
      phase.value = "idle";
      progress.value = null;
      abortController.value = null;
    }
  }

  void Promise.all([refreshResourceStatus(), refreshRepairResourceStatus()]);

  onBeforeUnmount(() => {
    abortController.value?.abort();
    void releaseInferenceSession().catch(() => undefined);
  });

  return {
    phase: readonly(phase),
    resourceStatus,
    resourceProgress: readonly(resourceProgress),
    repairResourceStatus,
    repairProgress: readonly(repairProgress),
    progress: readonly(progress),
    error: readonly(error),
    localModelsSupported,
    refreshResourceStatus,
    refreshRepairResourceStatus,
    installResourcePackage,
    installRepairResource,
    segmentSelections,
    createAutoLayers,
    cancel
  };
}
