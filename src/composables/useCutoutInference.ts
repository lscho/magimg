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
  clipMaskToBox,
  expandTextRepairMask,
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
import {
  chooseAutoLayerElementMaskCandidate,
  chooseSingleElementMaskCandidate,
  createCandidateConsensusAlpha,
  expandAutoLayerMaterialBox,
  expandAutoLayerSegmentationBox,
  restoreRefinedAlphaFromCandidateSupport
} from "@/services/cutoutMaskCandidate";
import {
  applyAutomaticNesting,
  cloneCutoutSelections,
  selectionChildren
} from "@/services/cutoutSelectionModel";
import { constrainAlphaToSelection } from "@/services/cutoutSelectionShape";
import {
  classifyAutoLayerElements,
  recognizeAutoLayerText,
  releaseAutoLayerRecognition
} from "@/services/autoLayerRecognition";
import { assignAutoLayerNames } from "@/services/autoLayerNaming";
import {
  createAutoLayerRepairAtlas,
  type AutoLayerRepairAtlas,
  type AutoLayerRepairRegion
} from "@/services/autoLayerRepairAtlas";
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
  cloudAtlas: AutoLayerRepairAtlas;
  diagnostics?: AutoLayerDiagnostics;
}

export interface AutoLayerCreationOptions {
  cloudMaxPixels?: number;
  cloudMaxBytes?: number;
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
        let polygonSupport: Uint8Array | null = null;
        let polygonConsensusSupport: Uint8Array | null = null;
        if (selection.polygon?.length) {
          const candidates = (await decodeCutoutCandidates(
            CUTOUT_MODEL,
            embedding,
            { box: selection },
            controller.signal
          )).map((candidate) => ({
            ...candidate,
            alpha: constrainAlphaToSelection(
              candidate.alpha,
              imageWidth,
              imageHeight,
              selection
            )
          }));
          polygonSupport = unionMasks(candidates.map((candidate) => candidate.alpha));
          polygonConsensusSupport = createCandidateConsensusAlpha(
            candidates.map((candidate) => candidate.alpha)
          );
          const candidate = chooseAutoLayerElementMaskCandidate(
            candidates,
            imageWidth,
            selection
          );
          if (!candidate) throw new Error("SAM 2.1 未返回可用的主体遮罩。");
          mask = candidate.alpha;
        } else if (optimizeSingleElement) {
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
        const refinedAlpha = constrainAlphaToSelection(await refineCutoutMask(
          CUTOUT_REFINER,
          image,
          imageWidth,
          imageHeight,
          mask,
          selection,
          controller.signal
        ), imageWidth, imageHeight, selection);
        refinedMasks.set(
          selection.id,
          polygonSupport && polygonConsensusSupport
            ? restoreRefinedAlphaFromCandidateSupport(
                refinedAlpha,
                polygonSupport,
                polygonConsensusSupport,
                imageWidth,
                imageHeight,
                selection
              )
            : refinedAlpha
        );
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

      const selections = applyAutomaticNesting(cloneCutoutSelections(inputSelections), {
        edgeToleranceRatio: 0.08
      });
      const elementSelections = selections.filter(selection => selection.layerKind !== "text");
      const textSelections = selections.filter(selection => selection.layerKind === "text");
      const refinedMasks = new Map<string, Uint8Array>();
      const coarseMasks = new Map<string, Uint8Array>();
      const classifications = new Map<string, { type: string; confidence: number }>();
      const elementDiagnostics: AutoLayerElementDiagnostic[] = [];
      const embedding = elementSelections.length
        ? await encodeCutoutImage(CUTOUT_MODEL, image, imageWidth, imageHeight, controller.signal)
        : null;

      for (let index = 0; index < elementSelections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const selection = elementSelections[index];
        const segmentationBox = expandAutoLayerSegmentationBox(selection, imageWidth, imageHeight);
        progress.value = { current: index + 1, total: elementSelections.length, stage: "segmenting" };
        const candidates = await decodeCutoutCandidates(
          CUTOUT_MODEL,
          embedding!,
          { box: segmentationBox },
          controller.signal
        );
        const candidate = chooseAutoLayerElementMaskCandidate(candidates, imageWidth, selection);
        if (!candidate) throw new Error("SAM 2.1 未返回可用的分层遮罩。");

        progress.value = { current: index + 1, total: elementSelections.length, stage: "refining" };
        const refinedAlpha = await refineCutoutMask(
          CUTOUT_REFINER,
          image,
          imageWidth,
          imageHeight,
          candidate.alpha,
          selection,
          controller.signal
        );
        refinedMasks.set(selection.id, refinedAlpha);
        coarseMasks.set(selection.id, candidate.alpha);
        if (options.collectDiagnostics) {
          elementDiagnostics.push({
            selection: cloneCutoutSelections([selection])[0],
            candidateScores: candidates.map(item => item.score),
            candidateAlphas: candidates.map(item => item.alpha),
            selectedCandidateIndex: Math.max(0, candidates.indexOf(candidate)),
            coarseAlpha: candidate.alpha,
            refinedAlpha
          });
        }
      }

      await releaseInferenceSession(CUTOUT_MODEL.id);
      const classificationResults = await classifyAutoLayerElements(image, elementSelections, controller.signal);
      elementSelections.forEach((selection, index) => {
        classifications.set(selection.id, classificationResults[index] ?? { type: "element", confidence: 0 });
      });
      const textLines = [] as AutoLayerTextItem[];
      const textGlyphMasks = new Map<string, Uint8Array>();
      for (let index = 0; index < textSelections.length; index += 1) {
        progress.value = { current: index + 1, total: textSelections.length, stage: "refining" };
        const selection = textSelections[index];
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

      const repairRegions: AutoLayerRepairRegion[] = [];
      for (let index = 0; index < elementSelections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const selection = elementSelections[index];
        const alpha = refinedMasks.get(selection.id);
        const coarse = coarseMasks.get(selection.id);
        if (!alpha || !coarse) continue;
        const materialBox = expandAutoLayerMaterialBox(
          alpha,
          imageWidth,
          imageHeight,
          selection
        );
        const directChildren = selectionChildren(selections, selection.id);
        const childMasks: Uint8Array[] = [];
        for (const child of directChildren) {
          if (child.layerKind === "text") {
            const recognizedLines = textLines.filter(line => line.sourceSelectionId === child.id);
            if (recognizedLines.length) {
              childMasks.push(...await Promise.all(recognizedLines.map(line =>
                textLayerMask(
                  line,
                  textGlyphMasks.get(line.id) ?? new Uint8Array(),
                  imageWidth,
                  imageHeight
                )
              )));
            } else {
              childMasks.push(rectangleMask(child, imageWidth, imageHeight));
            }
            continue;
          }
          const childAlpha = refinedMasks.get(child.id);
          const childCoarse = coarseMasks.get(child.id);
          if (childAlpha && childCoarse) childMasks.push(prepareRepairMask(
            buildHighRecallChildMask({
              refinedAlpha: childAlpha,
              coarseAlpha: childCoarse,
              width: imageWidth,
              height: imageHeight,
              child
            }),
            imageWidth,
            imageHeight
          ));
        }
        let materialSource: CanvasImageSource = image;
        if (childMasks.length) {
          progress.value = { current: index + 1, total: elementSelections.length, stage: "repairing" };
          const repairMask = clipMaskToBox(
            unionMasks(childMasks),
            imageWidth,
            imageHeight,
            selection
          );
          repairRegions.push({
            layerId: selection.id,
            contextBox: expandedRepairBox(selection, imageWidth, imageHeight),
            contentBox: materialBox,
            mask: repairMask
          });
          materialSource = await repairBackgroundLocally(
            image,
            imageWidth,
            imageHeight,
            repairMask,
            alpha,
            selection,
            {
              signal: controller.signal,
              // UI parent surfaces need deterministic fill; generative inpainting can redraw removed text.
              forceDiffusion: true
            }
          );
        }
        const exported = await maskToTransparentPng(
          materialSource,
          imageWidth,
          imageHeight,
          alpha,
          materialBox
        );
        const classification = classifications.get(selection.id) ?? { type: "element", confidence: 0 };
        materials.push({
          id: selection.id,
          blob: exported.blob,
          width: exported.width,
          height: exported.height,
          sourceBox: materialBox,
          sourceSelectionId: selection.id,
          parentId: selection.parentId,
          elementType: classification.type,
          classificationConfidence: classification.confidence,
          cleanedChildren: childMasks.length > 0,
          name: classification.type
        });
      }

      const backgroundCanvas = document.createElement("canvas");
      backgroundCanvas.width = imageWidth;
      backgroundCanvas.height = imageHeight;
      const context = backgroundCanvas.getContext("2d");
      if (!context) throw new Error("当前设备无法合成分层背景。");
      context.drawImage(image, 0, 0, imageWidth, imageHeight);
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
      const topLevelMasks: Uint8Array[] = [];
      for (const selection of selections.filter(item => !item.parentId)) {
        if (selection.layerKind === "text") {
          const recognizedLines = textLines.filter(line => line.sourceSelectionId === selection.id);
          const masks = recognizedLines.length
            ? recognizedLines.map(line => textLayerMask(
              line,
              textGlyphMasks.get(line.id) ?? new Uint8Array(),
              imageWidth,
              imageHeight
            ))
            : [rectangleMask(selection, imageWidth, imageHeight)];
          topLevelMasks.push(...masks);
          continue;
        }
        const refinedAlpha = refinedMasks.get(selection.id);
        const coarseAlpha = coarseMasks.get(selection.id);
        if (refinedAlpha && coarseAlpha) topLevelMasks.push(prepareRepairMask(buildHighRecallChildMask({
          refinedAlpha,
          coarseAlpha,
          width: imageWidth,
          height: imageHeight,
          child: selection
        }), imageWidth, imageHeight));
      }
      const backgroundMask = topLevelMasks.length
        ? unionMasks(topLevelMasks)
        : new Uint8Array(imageWidth * imageHeight);
      const cloudAtlas = await createAutoLayerRepairAtlas({
        source: image,
        imageWidth,
        imageHeight,
        backgroundMask,
        regions: repairRegions,
        maxPixels: options.cloudMaxPixels,
        maxBytes: options.cloudMaxBytes
      });
      return {
        backgroundBlob: await canvasToPngBlob(backgroundCanvas),
        materials,
        texts: textLines,
        cloudAtlas,
        ...(options.collectDiagnostics ? {
          diagnostics: {
            selections: cloneCutoutSelections(selections),
            elements: elementDiagnostics,
            repairRegions,
            backgroundMask
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
