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
  BIRENET_MODEL,
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
  CUTOUT_REPAIR_MODEL,
  downloadRepairModel,
  getRepairModelStatus
} from "@/services/cutoutRepairModelManager";
import {
  cancelInferenceRun,
  decodeCutoutCandidates,
  encodeCutoutImage,
  refineCutoutMask,
  releaseInferenceSession,
  segmentBirefnetBox
} from "@/services/cutoutInference";
import { maskToTransparentPng } from "@/services/cutoutExport";
import {
  buildHighRecallChildMask,
  buildRemovalMask,
  expandTextRepairMask,
  maskContainment,
  prepareRepairMask
} from "@/services/cutoutRepairMask";
import { shouldForceManualDiffusion } from "@/services/cutoutRepairContext";
import {
  compositeRepairedImage,
  repairBackgroundLocally
} from "@/services/cutoutBackgroundRepair";
import { maskArea, unionMasks } from "@/services/cutoutLayering";
import {
  chooseAutoLayerElementMaskCandidate,
  createCandidateConsensusAlpha,
  expandAutoLayerSegmentationBox,
  restoreRefinedAlphaFromCandidateSupport
} from "@/services/cutoutMaskCandidate";
import {
  cloneCutoutSelections,
  resolveAutoLayerHierarchy,
  selectionChildren
} from "@/services/cutoutSelectionModel";
import { constrainAlphaToSelection } from "@/services/cutoutSelectionShape";
import {
  applyOpaquePanelPrior,
  constrainAlphaToPanelOuter,
  createCompoundPanelGuidance,
  createCompoundPanelPrior
} from "@/services/cutoutCompoundPanel";
import {
  classifyAutoLayerElements,
  recognizeAutoLayerText,
  releaseAutoLayerRecognition
} from "@/services/autoLayerRecognition";
import { assignAutoLayerNames } from "@/services/autoLayerNaming";
import {
  type AutoLayerRepairRegion
} from "@/services/autoLayerRepairAtlas";
import { createAutoLayerBackgroundRegions } from "@/services/autoLayerBackgroundBoxes";
import {
  sampleBackgroundAnalysis,
  shouldExtractBackgroundLocally,
  type AutoLayerBackgroundAnalysis
} from "@/services/autoLayerBackgroundExtraction";
import type { AutoLayerTextItem } from "@/components/auto-layer/types";

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

type ResourcePart = "segmenter" | "refiner" | "repair";

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
  sourceSelectionId?: string;
  parentId?: string | null;
  elementType?: string;
  classificationConfidence?: number;
  cleanedChildren?: boolean;
  name?: string;
}

export interface AutoLayerInferenceResult {
  backgroundBlob: Blob;
  materials: AutoLayerMaterial[];
  texts: AutoLayerTextItem[];
  /** 复杂整页背景上传原始整页图与去重框选，不再上传修复蒙版。 */
  cloudBackground?: {
    imageBlob: Blob;
    /** 提交给服务端的外扩、合并生成区域。 */
    selectionBoxes: CutoutSelectionBox[];
    /** 客户端最终允许采纳生成 RGB 的原始框选区域。 */
    compositeBoxes: CutoutSelectionBox[];
  };
  diagnostics?: AutoLayerDiagnostics;
}

export interface AutoLayerCreationOptions {
  cloudMaxPixels?: number;
  cloudMaxBytes?: number;
  /** 生产流程直接复用用户原图；未提供时为回归工具生成无方向信息的 PNG。 */
  cloudSourceBlob?: Blob;
  /** 回归测试可强制导出云端输入；生产流程仍由背景复杂度自动分流。 */
  forceCloudBackground?: boolean;
  onMaterial?: (material: AutoLayerMaterial) => void;
  collectDiagnostics?: boolean;
  onDiagnosticStage?: (stage: string) => void;
}

export interface AutoLayerElementDiagnostic {
  selection: CutoutSelection;
  candidateScores: number[];
  candidateAlphas: Uint8Array[];
  selectedCandidateIndex: number;
  coarseAlpha: Uint8Array;
  refinedAlpha: Uint8Array;
}

export interface AutoLayerDiagnostics {
  selections: CutoutSelection[];
  elements: AutoLayerElementDiagnostic[];
  repairRegions: AutoLayerRepairRegion[];
  backgroundMask: Uint8Array;
  backgroundBoxes: CutoutSelectionBox[];
  /** 背景复杂度分析结果；本地提取表示纯色/渐变或低纹理背景不创建云端任务。 */
  backgroundExtraction?: AutoLayerBackgroundAnalysis;
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

async function canvasSourceToPngBlob(
  source: CanvasImageSource,
  width: number,
  height: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前设备无法生成云端背景输入。");
  context.drawImage(source, 0, 0, width, height);
  return canvasToPngBlob(canvas);
}

function rectangleMask(box: CutoutSelectionBox, width: number, height: number) {
  const mask = new Uint8Array(width * height);
  const left = Math.max(0, Math.floor(box.x));
  const top = Math.max(0, Math.floor(box.y));
  const right = Math.min(width, Math.ceil(box.x + box.width));
  const bottom = Math.min(height, Math.ceil(box.y + box.height));
  for (let y = top; y < bottom; y += 1) mask.fill(255, y * width + left, y * width + right);
  return mask;
}

function textLayerMask(
  line: AutoLayerTextItem,
  glyphAlpha: Uint8Array,
  width: number,
  height: number
) {
  const boxWidth = Math.max(1, Math.round(line.sourceBox.width));
  const boxHeight = Math.max(1, Math.round(line.sourceBox.height));
  if (glyphAlpha.length !== boxWidth * boxHeight) {
    throw new Error("文字字形蒙版尺寸无效。");
  }
  const mask = new Uint8Array(width * height);
  const left = Math.round(line.sourceBox.x);
  const top = Math.round(line.sourceBox.y);
  for (let y = 0; y < boxHeight; y += 1) {
    const targetY = top + y;
    if (targetY < 0 || targetY >= height) continue;
    for (let x = 0; x < boxWidth; x += 1) {
      const targetX = left + x;
      if (targetX < 0 || targetX >= width) continue;
      mask[targetY * width + targetX] = glyphAlpha[y * boxWidth + x];
    }
  }
  return expandTextRepairMask(mask, width, height, line.sourceBox);
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
 * 矩形与点选轮廓都沿用 SAM -> ViTMatte，背景只在合并移除蒙版后进入修复模型。
 */
export function useCutoutInference(options?: { segmentationModel?: "sam" | "birefnet" }) {
  const segmentationModel = options?.segmentationModel ?? "sam";
  const requiresRepairResource = segmentationModel === "sam";
  /** /cutout 使用的分割模型描述符（BiRefNet 或 SAM），/auto-layer 固定 SAM。 */
  const activeSegmenterModel = segmentationModel === "birefnet" ? BIRENET_MODEL : CUTOUT_MODEL;
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
    if (!resourceStatusChecked.value || (requiresRepairResource && !repairStatusChecked.value)) {
      return "checking";
    }
    if (segmenterStatus.value === "downloading" || refinerStatus.value === "downloading" ||
      (requiresRepairResource && repairStatus.value === "downloading")) {
      return "downloading";
    }
    if (segmenterStatus.value === "ready" && refinerStatus.value === "ready" &&
      (!requiresRepairResource || repairStatus.value === "ready")) return "ready";
    if (segmenterStatus.value === "error" || refinerStatus.value === "error" ||
      (requiresRepairResource && repairStatus.value === "error")) return "error";
    return "missing";
  });

  const repairResourceStatus = computed<CutoutResourceStatus>(() => {
    if (!repairStatusChecked.value) return "checking";
    return repairStatus.value;
  });

  function setResourcePartStatus(part: ResourcePart, status: CutoutModelStatus) {
    if (part === "segmenter") segmenterStatus.value = status;
    else if (part === "refiner") refinerStatus.value = status;
    else repairStatus.value = status;
  }

  async function refreshResourceStatus() {
    try {
      const [nextSegmenterStatus, nextRefinerStatus, nextRepairStatus] = await Promise.all([
        getModelStatus(activeSegmenterModel),
        getRefinerStatus(CUTOUT_REFINER),
        requiresRepairResource ? getRepairModelStatus() : Promise.resolve(repairStatus.value)
      ]);
      segmenterStatus.value = nextSegmenterStatus;
      refinerStatus.value = nextRefinerStatus;
      if (requiresRepairResource) {
        repairStatus.value = nextRepairStatus;
        repairStatusChecked.value = true;
      }
    } catch (exception) {
      segmenterStatus.value = "error";
      refinerStatus.value = "error";
      if (requiresRepairResource) {
        repairStatus.value = "error";
        repairStatusChecked.value = true;
      }
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
        sizeBytes: activeSegmenterModel.sizeBytes,
        install: (onProgress, signal) => downloadModel(activeSegmenterModel, onProgress, signal)
      });
    }
    if (refinerStatus.value !== "ready") {
      pendingParts.push({
        id: "refiner",
        sizeBytes: CUTOUT_REFINER.sizeBytes,
        install: (onProgress, signal) => downloadRefiner(CUTOUT_REFINER, onProgress, signal)
      });
    }
    if (requiresRepairResource && repairStatus.value !== "ready") {
      pendingParts.push({
        id: "repair",
        sizeBytes: CUTOUT_REPAIR_MODEL.sizeBytes,
        install: (onProgress, signal) => downloadRepairModel(onProgress, signal)
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
      error.value = "请先在画布上框选或点选要抠取的元素。";
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
        getModelStatus(activeSegmenterModel),
        getRefinerStatus(CUTOUT_REFINER)
      ]);
      segmenterStatus.value = nextSegmenterStatus;
      refinerStatus.value = nextRefinerStatus;
      resourceStatusChecked.value = true;
      if (nextSegmenterStatus !== "ready" || nextRefinerStatus !== "ready") {
        throw new Error("请先下载完整的 AI 抠图资源包。");
      }

      const selections = cloneCutoutSelections(inputSelections);
      const coarseMasks = new Map<string, Uint8Array>();
      const refinedMasks = new Map<string, Uint8Array>();
      for (let index = 0; index < selections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const selection = selections[index];
        progress.value = { current: index + 1, total: selections.length, stage: "segmenting" };
        // BiRefNet 单次前向分割：选区 bbox 外扩上下文后推理，返回全分辨率 alpha。
        // 多边形只提供更贴合物体的外接框提示，不做硬裁剪，最终 Alpha 由 ViTMatte 决定。
        const segmentedAlpha = await segmentBirefnetBox(
          activeSegmenterModel,
          image,
          imageWidth,
          imageHeight,
          selection,
          controller.signal
        );
        const panelPrior = createCompoundPanelPrior(
          image,
          imageWidth,
          imageHeight,
          selection
        );
        const mask = applyOpaquePanelPrior(segmentedAlpha, panelPrior);
        coarseMasks.set(selection.id, mask);
        progress.value = { current: index + 1, total: selections.length, stage: "refining" };
        const refinedAlpha = constrainAlphaToSelection(
          applyOpaquePanelPrior(await refineCutoutMask(
            CUTOUT_REFINER,
            image,
            imageWidth,
            imageHeight,
            mask,
            selection,
            controller.signal
          ), panelPrior),
          imageWidth,
          imageHeight,
          selection
        );
        refinedMasks.set(selection.id, refinedAlpha);
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
        // BiRefNet 无点提示能力：智能笔画降级为纯几何 add/restore 笔画，
        // smartMasks 保持为空，由 buildRemovalMask 中的 rasterizeStroke 处理。
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
        await releaseInferenceSession(activeSegmenterModel.id);
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
    options: AutoLayerCreationOptions = {}
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
      if (nextSegmenterStatus !== "ready" || nextRefinerStatus !== "ready" ||
        nextRepairStatus !== "ready") {
        throw new Error("请先下载完整的自动分层资源（包含 Big-LaMa）。");
      }

      const requestedSelections = cloneCutoutSelections(inputSelections);
      const elementSelections = requestedSelections.filter(selection => selection.layerKind !== "text");
      const refinedMasks = new Map<string, Uint8Array>();
      const coarseMasks = new Map<string, Uint8Array>();
      const classifications = new Map<string, { type: string; confidence: number }>();
      const deterministicPanelIds = new Set<string>();
      const elementDiagnostics: AutoLayerElementDiagnostic[] = [];
      const embedding = elementSelections.length
        ? await encodeCutoutImage(CUTOUT_MODEL, image, imageWidth, imageHeight, controller.signal)
        : null;

      for (let index = 0; index < elementSelections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const selection = elementSelections[index];
        progress.value = { current: index + 1, total: elementSelections.length, stage: "segmenting" };
        // 提示框在选框基础上小幅外扩补充上下文，改善贴边元素的分割；
        // 素材导出与选区覆盖仍按选框边界，不受提示范围影响。
        const promptBox = expandAutoLayerSegmentationBox(selection, imageWidth, imageHeight);
        const candidates = await decodeCutoutCandidates(
          CUTOUT_MODEL,
          embedding!,
          { box: promptBox },
          controller.signal
        );
        const candidate = chooseAutoLayerElementMaskCandidate(candidates, imageWidth, selection);
        if (!candidate) throw new Error("SAM 2.1 未返回可用的分层遮罩。");
        const panelGuidance = createCompoundPanelGuidance(image, imageWidth, imageHeight, selection);
        if (panelGuidance) deterministicPanelIds.add(selection.id);
        const panelPrior = panelGuidance?.interiorAlpha ?? null;
        const coarseAlpha = applyOpaquePanelPrior(
          constrainAlphaToPanelOuter(candidate.alpha, panelGuidance?.outerAlpha ?? null),
          panelPrior
        );
        const candidateSupport = applyOpaquePanelPrior(
          constrainAlphaToPanelOuter(
            unionMasks(candidates.map(item => item.alpha)),
            panelGuidance?.outerAlpha ?? null
          ),
          panelPrior
        );
        const candidateConsensus = createCandidateConsensusAlpha(candidates.map(item => item.alpha));

        progress.value = { current: index + 1, total: elementSelections.length, stage: "refining" };
        const refinedAlpha = restoreRefinedAlphaFromCandidateSupport(
          await refineCutoutMask(
            CUTOUT_REFINER,
            image,
            imageWidth,
            imageHeight,
            coarseAlpha,
            selection,
            controller.signal
          ),
          candidateSupport,
          candidateConsensus,
          imageWidth,
          imageHeight,
          selection
        );
        const panelRefinedAlpha = applyOpaquePanelPrior(
          constrainAlphaToPanelOuter(refinedAlpha, panelGuidance?.outerAlpha ?? null),
          panelPrior
        );
        refinedMasks.set(selection.id, panelRefinedAlpha);
        coarseMasks.set(selection.id, coarseAlpha);
        if (options.collectDiagnostics) {
          elementDiagnostics.push({
            selection: cloneCutoutSelections([selection])[0],
            candidateScores: candidates.map(item => item.score),
            candidateAlphas: candidates.map(item => item.alpha),
            selectedCandidateIndex: Math.max(0, candidates.indexOf(candidate)),
            coarseAlpha,
            refinedAlpha: panelRefinedAlpha
          });
        }
      }

      await releaseInferenceSession(CUTOUT_MODEL.id);
      const selections = resolveAutoLayerHierarchy(
        requestedSelections,
        validateAutomaticRelations(elementSelections, refinedMasks)
      );
      const resolvedElementSelections = selections.filter(selection => selection.layerKind !== "text");
      const resolvedTextSelections = selections.filter(selection => selection.layerKind === "text");
      // 分类器与 OCR 使用独立的原生模型会话，可以并行；同一 OCR 会话内仍按框串行。
      const classificationPromise = classifyAutoLayerElements(image, elementSelections, controller.signal);
      const textRecognitionPromise = (async () => {
        const textLines = [] as AutoLayerTextItem[];
        const textGlyphMasks = new Map<string, Uint8Array>();
        for (let index = 0; index < resolvedTextSelections.length; index += 1) {
          progress.value = { current: index + 1, total: resolvedTextSelections.length, stage: "refining" };
          const selection = resolvedTextSelections[index];
          options.onDiagnosticStage?.(`ocr:${index + 1}:start`);
          const lines = await recognizeAutoLayerText(
            image,
            selection,
            controller.signal,
            stage => options.onDiagnosticStage?.(`ocr:${index + 1}:${stage}`)
          );
          options.onDiagnosticStage?.(`ocr:${index + 1}:complete`);
          for (const line of lines) {
            textGlyphMasks.set(line.id, line.glyphAlpha);
            textLines.push({
              id: line.id,
              name: "text",
              kind: "text",
              blob: line.blob,
              sourceBox: line.box,
              sourceSelectionId: selection.id,
              parentId: selection.parentId,
              recognitionConfidence: line.confidence,
              text: line.text,
              ocrConfidence: line.confidence,
              fontSize: line.fontSize,
              fontWeight: line.fontWeight,
              fontCategory: line.fontCategory,
              color: line.color,
              x: line.box.x,
              y: line.box.y,
              width: line.box.width,
              height: line.box.height,
              visible: true
            });
          }
        }
        return { textLines, textGlyphMasks };
      })();
      const [classificationResults, textRecognition] = await Promise.all([
        classificationPromise,
        textRecognitionPromise
      ]);
      elementSelections.forEach((selection, index) => {
        classifications.set(selection.id, classificationResults[index] ?? { type: "element", confidence: 0 });
      });
      const { textLines, textGlyphMasks } = textRecognition;

      const repairRegions: AutoLayerRepairRegion[] = [];
      const highRecallMasks = new Map<string, Uint8Array>();
      for (const selection of resolvedElementSelections) {
        const refinedAlpha = refinedMasks.get(selection.id);
        const coarseAlpha = coarseMasks.get(selection.id);
        if (!refinedAlpha || !coarseAlpha) continue;
        highRecallMasks.set(selection.id, buildHighRecallChildMask({
          refinedAlpha,
          coarseAlpha,
          width: imageWidth,
          height: imageHeight,
          child: selection
        }));
      }
      const textMasksForSelection = (selection: CutoutSelection) => {
        const recognizedLines = textLines.filter(line => line.sourceSelectionId === selection.id);
        return recognizedLines.length
          ? recognizedLines.map(line => textLayerMask(
            line,
            textGlyphMasks.get(line.id) ?? new Uint8Array(),
            imageWidth,
            imageHeight
          ))
          : [rectangleMask(selection, imageWidth, imageHeight)];
      };

      for (let index = 0; index < resolvedElementSelections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const selection = resolvedElementSelections[index];
        const alpha = refinedMasks.get(selection.id);
        if (!alpha) continue;
        const directChildren = selectionChildren(selections, selection.id);
        const childAlphas = directChildren.flatMap(child => {
          if (child.layerKind === "text") return textMasksForSelection(child);
          const childAlpha = highRecallMasks.get(child.id);
          return childAlpha ? [childAlpha] : [];
        });
        const combined = buildRemovalMask({
          width: imageWidth,
          height: imageHeight,
          parent: selection,
          parentAlpha: alpha,
          childAlphas,
          strokes: selection.removalStrokes,
          smartMasks: new Map()
        });
        const repairMask = hasMask(combined)
          ? prepareRepairMask(combined, imageWidth, imageHeight, selection)
          : combined;
        let materialSource: CanvasImageSource = image;
        const cleanedChildren = hasMask(repairMask);
        if (cleanedChildren) {
          progress.value = {
            current: index + 1,
            total: resolvedElementSelections.length,
            stage: "repairing"
          };
          materialSource = await repairBackgroundLocally(
            image,
            imageWidth,
            imageHeight,
            repairMask,
            alpha,
            selection,
            {
              signal: controller.signal,
              forceDiffusion: deterministicPanelIds.has(selection.id)
            }
          );
          repairRegions.push({
            layerId: selection.id,
            contextBox: expandedRepairBox(selection, imageWidth, imageHeight),
            contentBox: { ...selection },
            mask: repairMask
          });
        }
        // 素材按选框边界直接导出，不按 Alpha 内容扩张。
        const exported = await maskToTransparentPng(
          materialSource,
          imageWidth,
          imageHeight,
          alpha,
          selection
        );
        const classification = classifications.get(selection.id) ?? { type: "element", confidence: 0 };
        materials.push({
          id: selection.id,
          blob: exported.blob,
          width: exported.width,
          height: exported.height,
          sourceBox: { ...selection },
          sourceSelectionId: selection.id,
          parentId: selection.parentId,
          elementType: classification.type,
          classificationConfidence: classification.confidence,
          cleanedChildren,
          name: classification.type
        });
      }

      // 整页背景只移除顶级图层；嵌套子层已由父素材的独立修复链路处理。
      const removalMasks = selections.filter(selection => !selection.parentId).flatMap(selection => {
        if (selection.layerKind === "text") {
          return textMasksForSelection(selection).map(alpha => ({ selection, alpha }));
        }
        const highRecall = highRecallMasks.get(selection.id);
        return highRecall ? [{
          selection,
          alpha: prepareRepairMask(highRecall, imageWidth, imageHeight)
        }] : [];
      });
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
      const localBackgroundBlobPromise = canvasToPngBlob(backgroundCanvas);
      const topLevelMasks = removalMasks.map(item => item.alpha);
      const backgroundMask = topLevelMasks.length
        ? unionMasks(topLevelMasks)
        : new Uint8Array(imageWidth * imageHeight);
      const backgroundAnalysisPromise = sampleBackgroundAnalysis(
        image,
        imageWidth,
        imageHeight,
        backgroundMask
      );
      const nameCandidates = [
        ...materials.map(material => ({
          id: material.id, kind: "material" as const, box: material.sourceBox,
          type: material.elementType ?? "element", confidence: material.classificationConfidence ?? 0,
          cleanedChildren: material.cleanedChildren
        })),
        ...textLines.map(line => ({
          id: line.id, kind: "text" as const, box: line.sourceBox,
          type: "text", confidence: line.ocrConfidence
        }))
      ];
      const names = assignAutoLayerNames(nameCandidates, imageWidth, imageHeight);
      for (const material of materials) {
        material.name = names.get(material.id) ?? material.name;
        options.onMaterial?.(material);
      }
      for (const line of textLines) line.name = names.get(line.id) ?? "text";
      // 纯色/缓渐变背景：本地扩散直接提取背景，不创建云端 inpainting 任务，
      // 蒙版区域不会出现生成模型臆造的内容，且不消耗云端积分。
      const [localBackgroundBlob, backgroundAnalysis] = await Promise.all([
        localBackgroundBlobPromise,
        backgroundAnalysisPromise
      ]);
      const extractLocally = !options.forceCloudBackground && shouldExtractBackgroundLocally(backgroundAnalysis);
      const backgroundRegions = createAutoLayerBackgroundRegions(
        selections.filter(selection => !selection.parentId),
        imageWidth,
        imageHeight
      );
      const backgroundBoxes = backgroundRegions.selectionBoxes;
      const cloudBackground = extractLocally || !backgroundBoxes.length
        ? null
        : {
          // 无蒙版编辑直接从原图删除框内内容，避免把本地扩散的涂抹块
          // 当成背景纹理继续放大；本地修复稿仍作为云任务失败时的草稿。
          imageBlob: options.cloudSourceBlob
            ?? await canvasSourceToPngBlob(image, imageWidth, imageHeight),
          selectionBoxes: backgroundBoxes,
          compositeBoxes: backgroundRegions.compositeBoxes
        };
      return {
        backgroundBlob: localBackgroundBlob,
        materials,
        texts: textLines,
        ...(cloudBackground ? { cloudBackground } : {}),
        ...(options.collectDiagnostics ? {
          diagnostics: {
            selections: cloneCutoutSelections(selections),
            elements: elementDiagnostics,
            repairRegions,
            backgroundMask,
            backgroundBoxes,
            ...(backgroundAnalysis ? { backgroundExtraction: backgroundAnalysis } : {})
          }
        } : {})
      };
    } catch (exception) {
      error.value = controller.signal.aborted
        ? "自动分层已取消。"
        : exception instanceof Error
          ? exception.message
          : typeof exception === "string" && exception.trim()
            ? exception.trim()
            : "自动分层失败，请稍后重试。";
      return null;
    } finally {
      await releaseAutoLayerRecognition().catch(() => undefined);
      phase.value = "idle";
      progress.value = null;
      abortController.value = null;
    }
  }

  if (requiresRepairResource) void refreshResourceStatus();
  else void Promise.all([refreshResourceStatus(), refreshRepairResourceStatus()]);

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
