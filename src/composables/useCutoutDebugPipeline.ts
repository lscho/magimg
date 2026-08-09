import { onBeforeUnmount, readonly, ref, shallowRef } from "vue";
import type { CutoutSelection } from "@/types";
import {
  BIRENET_MODEL,
  CUTOUT_MODEL,
  getModelStatus,
  supportsLocalCutoutModels
} from "@/services/cutoutModelManager";
import { CUTOUT_REFINER, getRefinerStatus } from "@/services/cutoutRefinerManager";
import { getRepairModelStatus } from "@/services/cutoutRepairModelManager";
import {
  cancelInferenceRun,
  decodeCutoutCandidates,
  encodeCutoutImage,
  refineCutoutMask,
  releaseInferenceSession,
  segmentBirefnetBox,
  type CutoutRefineDebugSnapshot
} from "@/services/cutoutInference";
import {
  chooseAutoLayerElementMaskCandidate,
  createCandidateConsensusAlpha,
  expandAutoLayerSegmentationBox,
  restoreRefinedAlphaFromCandidateSupport
} from "@/services/cutoutMaskCandidate";
import { constrainAlphaToSelection } from "@/services/cutoutSelectionShape";
import {
  applyOpaquePanelPrior,
  createCompoundPanelPrior
} from "@/services/cutoutCompoundPanel";
import {
  buildHighRecallChildMask,
  buildRemovalMask,
  prepareRepairMask
} from "@/services/cutoutRepairMask";
import { alphaContentBounds, shouldForceManualDiffusion } from "@/services/cutoutRepairContext";
import { repairBackgroundLocally } from "@/services/cutoutBackgroundRepair";
import { maskToTransparentPng } from "@/services/cutoutExport";
import { unionMasks } from "@/services/cutoutLayering";
import { cloneCutoutSelections, selectionChildren } from "@/services/cutoutSelectionModel";
import {
  blobPreviewUrl,
  formatDuration,
  formatPercent,
  maskDiff,
  maskStats,
  renderAlphaCompositePreview,
  renderImagePreview,
  renderMaskDiffPreview,
  renderMaskPreview,
  renderOverlayPreview,
  renderTrimapPreview
} from "@/services/cutoutDebugPreview";

/** 分割档位：/cutout 使用 BiRefNet，/auto-layer 使用 SAM 2.1 多候选。 */
export type CutoutDebugSegmenter = "birefnet" | "sam";
/** 本地背景修复分流：自动按链路规则，或强制走扩散 / Big-LaMa。 */
export type CutoutDebugRepairMode = "auto" | "diffusion" | "model";

export interface CutoutDebugArtifact {
  id: string;
  label: string;
  url: string;
  note?: string;
}

export interface CutoutDebugMetric {
  label: string;
  value: string;
}

export type CutoutDebugStageStatus = "running" | "done" | "skipped" | "error";

export interface CutoutDebugStage {
  id: string;
  /** 环节名称，例如「ViTMatte 精修」。 */
  title: string;
  /** 归属对象，整图环节为空字符串。 */
  scope: string;
  status: CutoutDebugStageStatus;
  durationMs: number;
  summary: string;
  metrics: CutoutDebugMetric[];
  artifacts: CutoutDebugArtifact[];
  error?: string;
}

export interface CutoutDebugRunInput {
  image: CanvasImageSource;
  imageWidth: number;
  imageHeight: number;
  selections: CutoutSelection[];
  /** 默认分割档位，应用于未单独指定的选区。 */
  segmenter: CutoutDebugSegmenter;
  /** 逐选区覆盖：key 为选区 id，值优先于 segmenter。用于复合对象（人物 BiRefNet + 面板 SAM）一次性推理。 */
  segmenterBySelection?: Record<string, CutoutDebugSegmenter>;
  repairMode: CutoutDebugRepairMode;
}

export interface CutoutDebugResourceState {
  birefnet: string;
  sam: string;
  refiner: string;
  repair: string;
}

function abortError() {
  return new DOMException("调试流程已取消。", "AbortError");
}

function selectionLabel(selection: CutoutSelection, index: number) {
  const shape = selection.polygon?.length ? "多边形" : "矩形";
  const behavior = selection.behavior === "background" ? "背景" : "素材";
  const kind = selection.layerKind === "text" ? "・文字" : "";
  return `选区 ${index + 1}（${shape}・${behavior}${kind}）`;
}

function boxMetric(box: { x: number; y: number; width: number; height: number }) {
  return `${Math.round(box.x)}, ${Math.round(box.y)} · ${Math.round(box.width)}×${Math.round(box.height)}`;
}

function maskMetrics(mask: Uint8Array): CutoutDebugMetric[] {
  const stats = maskStats(mask);
  return [
    { label: "覆盖像素", value: stats.area.toLocaleString("zh-CN") },
    { label: "覆盖率", value: formatPercent(stats.coverage) },
    { label: "半透明像素", value: stats.softArea.toLocaleString("zh-CN") },
    { label: "Alpha 峰值", value: String(stats.maxValue) }
  ];
}

function diffMetrics(before: Uint8Array, after: Uint8Array): CutoutDebugMetric[] {
  const diff = maskDiff(before, after);
  return [
    { label: "IoU", value: diff.iou.toFixed(4) },
    { label: "收缩像素", value: diff.onlyBefore.toLocaleString("zh-CN") },
    { label: "新增像素", value: diff.onlyAfter.toLocaleString("zh-CN") }
  ];
}

/**
 * 开发模式调试流水线：按 AI 抠图链路顺序逐环节执行，并保留每一步的
 * 输入输出预览与定量指标。不预扣积分、不写抠图历史、不创建任何云端任务。
 */
export function useCutoutDebugPipeline() {
  const stages = ref<CutoutDebugStage[]>([]);
  const running = shallowRef(false);
  const error = shallowRef("");
  const totalDurationMs = shallowRef(0);
  const resources = ref<CutoutDebugResourceState>({
    birefnet: "checking",
    sam: "checking",
    refiner: "checking",
    repair: "checking"
  });
  const localModelsSupported = supportsLocalCutoutModels();
  const abortController = shallowRef<AbortController | null>(null);
  let objectUrls: string[] = [];

  function trackUrl(url: string) {
    objectUrls.push(url);
    return url;
  }

  function releaseUrls() {
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls = [];
  }

  function reset() {
    stages.value = [];
    error.value = "";
    totalDurationMs.value = 0;
    releaseUrls();
  }

  async function refreshResources() {
    if (!localModelsSupported) {
      resources.value = {
        birefnet: "unsupported",
        sam: "unsupported",
        refiner: "unsupported",
        repair: "unsupported"
      };
      return;
    }
    const [birefnet, sam, refiner, repair] = await Promise.all([
      getModelStatus(BIRENET_MODEL).catch(() => "error" as const),
      getModelStatus(CUTOUT_MODEL).catch(() => "error" as const),
      getRefinerStatus(CUTOUT_REFINER).catch(() => "error" as const),
      getRepairModelStatus().catch(() => "error" as const)
    ]);
    resources.value = { birefnet, sam, refiner, repair };
  }

  function beginStage(title: string, scope: string) {
    const stage: CutoutDebugStage = {
      id: `${scope || "global"}-${title}-${stages.value.length}`,
      title,
      scope,
      status: "running",
      durationMs: 0,
      summary: "",
      metrics: [],
      artifacts: []
    };
    stages.value = [...stages.value, stage];
    return { stage, startedAt: performance.now() };
  }

  function finishStage(
    handle: { stage: CutoutDebugStage; startedAt: number },
    patch: Partial<Omit<CutoutDebugStage, "id" | "title" | "scope">>
  ) {
    Object.assign(handle.stage, {
      status: "done" as CutoutDebugStageStatus,
      durationMs: performance.now() - handle.startedAt,
      ...patch
    });
    stages.value = [...stages.value];
  }

  function failStage(
    handle: { stage: CutoutDebugStage; startedAt: number },
    exception: unknown
  ) {
    Object.assign(handle.stage, {
      status: "error" as CutoutDebugStageStatus,
      durationMs: performance.now() - handle.startedAt,
      error: exception instanceof Error ? exception.message : String(exception)
    });
    stages.value = [...stages.value];
  }

  async function artifact(
    id: string,
    label: string,
    render: Promise<string>,
    note?: string
  ): Promise<CutoutDebugArtifact> {
    return { id, label, url: trackUrl(await render), ...(note ? { note } : {}) };
  }

  function cancel() {
    abortController.value?.abort();
    void cancelInferenceRun().catch(() => undefined);
  }

  async function run(input: CutoutDebugRunInput) {
    if (running.value) return;
    if (!localModelsSupported) {
      error.value = "浏览器预览不能运行本地模型，请在桌面客户端中调试。";
      return;
    }
    if (!input.selections.length) {
      error.value = "请先在左侧画布框选或点选要调试的元素。";
      return;
    }
    reset();
    running.value = true;
    const controller = new AbortController();
    abortController.value = controller;
    const startedAt = performance.now();
    const { image, imageWidth, imageHeight } = input;
    const selections = cloneCutoutSelections(input.selections);
    const usedSegmenters = new Set<CutoutDebugSegmenter>();
    for (const item of selections) {
      usedSegmenters.add(input.segmenterBySelection?.[item.id] ?? input.segmenter);
    }
    const usesSam = usedSegmenters.has("sam");
    const usesBirefnet = usedSegmenters.has("birefnet");
    const coarseMasks = new Map<string, Uint8Array>();
    const refinedMasks = new Map<string, Uint8Array>();

    try {
      await refreshResources();
      const missingModels: string[] = [];
      if (usesBirefnet && resources.value.birefnet !== "ready") missingModels.push("BiRefNet");
      if (usesSam && resources.value.sam !== "ready") missingModels.push("SAM 2.1");
      if (resources.value.refiner !== "ready") missingModels.push("ViTMatte");
      if (missingModels.length) {
        throw new Error(`以下模型未就绪：${missingModels.join("、")}。请先在 AI 抠图页下载资源包。`);
      }

      const inputStage = beginStage("输入图片与选区", "");
      finishStage(inputStage, {
        summary: `${imageWidth}×${imageHeight}，共 ${selections.length} 个选区`,
        metrics: [
          {
            label: "分割档位",
            value: usesBirefnet && usesSam
              ? `混合（BiRefNet ×${selections.filter((s) => (input.segmenterBySelection?.[s.id] ?? input.segmenter) === "birefnet").length} / SAM ×${selections.filter((s) => (input.segmenterBySelection?.[s.id] ?? input.segmenter) === "sam").length}）`
              : input.segmenter === "birefnet" ? "BiRefNet Swin-T" : "SAM 2.1 Hiera B+"
          },
          { label: "精修模型", value: "ViTMatte Base" },
          {
            label: "修复分流",
            value: input.repairMode === "auto"
              ? "自动"
              : input.repairMode === "diffusion" ? "强制扩散" : "强制 Big-LaMa"
          },
          { label: "背景选区", value: String(selections.filter((item) => item.behavior === "background").length) }
        ],
        artifacts: [
          await artifact(
            "source",
            "原图",
            renderImagePreview(image, imageWidth, imageHeight)
          )
        ]
      });

      let embedding = null as Awaited<ReturnType<typeof encodeCutoutImage>> | null;
      if (usesSam) {
        const encodeStage = beginStage("SAM encoder 编码", "");
        try {
          embedding = await encodeCutoutImage(
            CUTOUT_MODEL,
            image,
            imageWidth,
            imageHeight,
            controller.signal
          );
          finishStage(encodeStage, {
            summary: "整图编码完成，所有选区复用同一份 embedding",
            metrics: [
              { label: "输入尺寸", value: `${embedding.inputWidth}×${embedding.inputHeight}` },
              { label: "特征尺寸", value: `${embedding.maskWidth}×${embedding.maskHeight}` }
            ]
          });
        } catch (exception) {
          failStage(encodeStage, exception);
          throw exception;
        }
      }

      for (let index = 0; index < selections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const selection = selections[index];
        const scope = selectionLabel(selection, index);
        const selSeg = input.segmenterBySelection?.[selection.id] ?? input.segmenter;

        // 1. 分割：BiRefNet 单次前向，或 SAM decoder 多候选。
        const segmentStage = beginStage(
          selSeg === "birefnet" ? "BiRefNet 分割" : "SAM decoder 候选",
          scope
        );
        let coarseAlpha: Uint8Array;
        let candidateSupport: Uint8Array | null = null;
        let candidateConsensus: Uint8Array | null = null;
        let panelPrior: Uint8Array | null = null;
        try {
          if (selSeg === "birefnet") {
            const segmentedAlpha = await segmentBirefnetBox(
              BIRENET_MODEL,
              image,
              imageWidth,
              imageHeight,
              selection,
              controller.signal
            );
            panelPrior = createCompoundPanelPrior(image, imageWidth, imageHeight, selection);
            coarseAlpha = applyOpaquePanelPrior(segmentedAlpha, panelPrior);
            finishStage(segmentStage, {
              summary: panelPrior
                ? "BiRefNet 软 Alpha 已合并闭合面板内部先验"
                : "选区外扩上下文后单次前向，输出全分辨率软 Alpha",
              metrics: [
                { label: "选区", value: boxMetric(selection) },
                ...maskMetrics(coarseAlpha)
              ],
              artifacts: [
                await artifact(
                  `${selection.id}-coarse-mask`,
                  "分割 Alpha",
                  renderMaskPreview(coarseAlpha, imageWidth, imageHeight)
                ),
                await artifact(
                  `${selection.id}-coarse-overlay`,
                  "原图叠加",
                  renderOverlayPreview(image, coarseAlpha, imageWidth, imageHeight)
                )
              ]
            });
          } else {
            const promptBox = expandAutoLayerSegmentationBox(selection, imageWidth, imageHeight);
            const candidates = await decodeCutoutCandidates(
              CUTOUT_MODEL,
              embedding!,
              { box: promptBox },
              controller.signal
            );
            const chosen = chooseAutoLayerElementMaskCandidate(candidates, imageWidth, selection);
            if (!chosen) throw new Error("SAM 2.1 未返回可用候选遮罩。");
            coarseAlpha = chosen.alpha;
            candidateSupport = unionMasks(candidates.map((item) => item.alpha));
            candidateConsensus = createCandidateConsensusAlpha(candidates.map((item) => item.alpha));
            const chosenIndex = Math.max(0, candidates.indexOf(chosen));
            const candidateArtifacts: CutoutDebugArtifact[] = [];
            for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
              const candidate = candidates[candidateIndex];
              candidateArtifacts.push(await artifact(
                `${selection.id}-candidate-${candidateIndex}`,
                `候选 ${candidateIndex + 1}${candidateIndex === chosenIndex ? "（选中）" : ""}`,
                renderOverlayPreview(
                  image,
                  candidate.alpha,
                  imageWidth,
                  imageHeight,
                  candidateIndex === chosenIndex ? [96, 220, 150] : [140, 150, 170]
                ),
                `IoU 评分 ${candidate.score.toFixed(4)}`
              ));
            }
            candidateArtifacts.push(await artifact(
              `${selection.id}-candidate-consensus`,
              "候选共识 Alpha",
              renderMaskPreview(candidateConsensus, imageWidth, imageHeight),
              "至少两个候选共同支持的前景强度"
            ));
            finishStage(segmentStage, {
              summary: `提示框外扩后返回 ${candidates.length} 个粒度候选，已选第 ${chosenIndex + 1} 个`,
              metrics: [
                { label: "提示框", value: boxMetric(promptBox) },
                { label: "候选评分", value: candidates.map((item) => item.score.toFixed(3)).join(" / ") },
                ...maskMetrics(coarseAlpha)
              ],
              artifacts: candidateArtifacts
            });
          }
        } catch (exception) {
          failStage(segmentStage, exception);
          throw exception;
        }
        coarseMasks.set(selection.id, coarseAlpha);

        // 2. 精修：先展示 ViTMatte 的 trimap 输入，再展示输出 Alpha。
        const trimapStage = beginStage("ViTMatte trimap 输入", scope);
        const refineStage = beginStage("ViTMatte 精修", scope);
        let refinedAlpha: Uint8Array;
        try {
          let snapshot: CutoutRefineDebugSnapshot | null = null;
          refinedAlpha = await refineCutoutMask(
            CUTOUT_REFINER,
            image,
            imageWidth,
            imageHeight,
            coarseAlpha,
            selection,
            controller.signal,
            (next) => {
              snapshot = next;
            }
          );
          refinedAlpha = applyOpaquePanelPrior(refinedAlpha, panelPrior);
          const captured = snapshot as CutoutRefineDebugSnapshot | null;
          if (captured) {
            finishStage(trimapStage, {
              summary: "白=确定前景，蓝=未知带（交给精修判断），黑=确定背景",
              metrics: [
                { label: "裁剪区域", value: `${captured.bounds.x}, ${captured.bounds.y} · ${captured.bounds.width}×${captured.bounds.height}` },
                { label: "绘制尺寸", value: `${captured.trimapWidth}×${captured.trimapHeight}` },
                { label: "模型输入", value: `${captured.inputWidth}×${captured.inputHeight}` },
                { label: "导向上采样", value: captured.guidedUpsample ? "是" : "否" }
              ],
              artifacts: [
                await artifact(
                  `${selection.id}-trimap`,
                  "Trimap",
                  renderTrimapPreview(captured.trimap, captured.trimapWidth, captured.trimapHeight)
                )
              ]
            });
          } else {
            finishStage(trimapStage, { status: "skipped", summary: "未捕获到 trimap 快照" });
          }
          finishStage(refineStage, {
            summary: "在分割 Alpha 基础上恢复边缘细节，红=被收缩，绿=被补出",
            metrics: [...maskMetrics(refinedAlpha), ...diffMetrics(coarseAlpha, refinedAlpha)],
            artifacts: [
              await artifact(
                `${selection.id}-refined-mask`,
                "精修 Alpha",
                renderMaskPreview(refinedAlpha, imageWidth, imageHeight)
              ),
              await artifact(
                `${selection.id}-refine-diff`,
                "精修前后差异",
                renderMaskDiffPreview(coarseAlpha, refinedAlpha, imageWidth, imageHeight)
              ),
              await artifact(
                `${selection.id}-refined-overlay`,
                "原图叠加",
                renderOverlayPreview(image, refinedAlpha, imageWidth, imageHeight, [120, 220, 170])
              )
            ]
          });
        } catch (exception) {
          if (trimapStage.stage.status === "running") failStage(trimapStage, exception);
          failStage(refineStage, exception);
          throw exception;
        }

        // 3. 后处理：多边形约束（BiRefNet 档）或候选共识恢复（SAM 档）。
        const postStage = beginStage(
          selSeg === "birefnet" ? "多边形选区约束" : "候选共识内部恢复",
          scope
        );
        try {
          let processed = refinedAlpha;
          let skipped = false;
          if (selSeg === "birefnet") {
            if (selection.polygon?.length) {
              processed = constrainAlphaToSelection(refinedAlpha, imageWidth, imageHeight, selection);
            } else {
              skipped = true;
            }
          } else if (candidateSupport && candidateConsensus) {
            processed = restoreRefinedAlphaFromCandidateSupport(
              refinedAlpha,
              candidateSupport,
              candidateConsensus,
              imageWidth,
              imageHeight,
              selection
            );
          } else {
            skipped = true;
          }
          if (skipped) {
            finishStage(postStage, {
              status: "skipped",
              summary: selSeg === "birefnet"
                ? "矩形选区不做多边形约束"
                : "无候选支持数据，跳过内部恢复"
            });
          } else {
            finishStage(postStage, {
              summary: input.segmenter === "birefnet"
                ? "按多边形轮廓裁剪精修 Alpha"
                : "恢复被精修误判为透明的封闭内部像素",
              metrics: [...maskMetrics(processed), ...diffMetrics(refinedAlpha, processed)],
              artifacts: [
                await artifact(
                  `${selection.id}-post-mask`,
                  "处理后 Alpha",
                  renderMaskPreview(processed, imageWidth, imageHeight)
                ),
                await artifact(
                  `${selection.id}-post-diff`,
                  "处理前后差异",
                  renderMaskDiffPreview(refinedAlpha, processed, imageWidth, imageHeight)
                )
              ]
            });
          }
          refinedMasks.set(selection.id, processed);
        } catch (exception) {
          failStage(postStage, exception);
          throw exception;
        }
      }

      // 4. 素材导出：与生产一致按选区 bbox 裁剪透明 PNG。
      for (let index = 0; index < selections.length; index += 1) {
        if (controller.signal.aborted) throw abortError();
        const selection = selections[index];
        if (selection.behavior !== "extract") continue;
        const alpha = refinedMasks.get(selection.id);
        if (!alpha) continue;
        const scope = selectionLabel(selection, index);
        const exportStage = beginStage("透明素材导出", scope);
        try {
          const exported = await maskToTransparentPng(
            image,
            imageWidth,
            imageHeight,
            alpha,
            selection
          );
          finishStage(exportStage, {
            summary: "按选区 bbox 裁剪，Alpha 与原图 Alpha 相乘",
            metrics: [
              { label: "输出尺寸", value: `${exported.width}×${exported.height}` },
              { label: "文件大小", value: `${(exported.blob.size / 1024).toFixed(1)} KB` }
            ],
            artifacts: [
              await artifact(
                `${selection.id}-material`,
                "透明素材",
                Promise.resolve(blobPreviewUrl(exported.blob))
              ),
              await artifact(
                `${selection.id}-material-checker`,
                "棋盘合成预览",
                renderAlphaCompositePreview(image, alpha, imageWidth, imageHeight)
              )
            ]
          });
        } catch (exception) {
          failStage(exportStage, exception);
          throw exception;
        }
      }

      // 5. 背景链路：移除蒙版 -> 本地修复 -> 背景素材导出。
      const backgroundSelections = selections.filter((item) => item.behavior === "background");
      if (backgroundSelections.length) {
        if (usesBirefnet) await releaseInferenceSession(BIRENET_MODEL.id).catch(() => undefined);
        if (usesSam) await releaseInferenceSession(CUTOUT_MODEL.id).catch(() => undefined);
      }
      for (const parent of backgroundSelections) {
        if (controller.signal.aborted) throw abortError();
        const parentIndex = selections.indexOf(parent);
        const scope = selectionLabel(parent, parentIndex);
        const parentAlpha = refinedMasks.get(parent.id);
        if (!parentAlpha) continue;
        const children = selectionChildren(selections, parent.id);

        const maskStage = beginStage("背景移除蒙版", scope);
        let repairMask: Uint8Array;
        try {
          const childAlphas = children
            .map((child) => {
              const refined = refinedMasks.get(child.id);
              const coarse = coarseMasks.get(child.id);
              return refined && coarse
                ? buildHighRecallChildMask({
                  refinedAlpha: refined,
                  coarseAlpha: coarse,
                  width: imageWidth,
                  height: imageHeight,
                  child
                })
                : refined;
            })
            .filter((mask): mask is Uint8Array => Boolean(mask));
          const combined = buildRemovalMask({
            width: imageWidth,
            height: imageHeight,
            parent,
            parentAlpha,
            childAlphas,
            strokes: parent.removalStrokes,
            smartMasks: new Map<string, Uint8Array>()
          });
          const hasCombined = maskStats(combined).area > 0;
          repairMask = hasCombined
            ? prepareRepairMask(combined, imageWidth, imageHeight, parent)
            : combined;
          finishStage(maskStage, {
            status: hasCombined ? "done" : "skipped",
            summary: hasCombined
              ? "子选区高召回蒙版 + 手动笔画合并后做羽化扩张"
              : "该背景选区没有子元素或移除笔画，无需修复",
            metrics: [
              { label: "子选区", value: String(children.length) },
              { label: "移除笔画", value: String(parent.removalStrokes.length) },
              ...maskMetrics(repairMask)
            ],
            artifacts: hasCombined
              ? [
                await artifact(
                  `${parent.id}-removal-raw`,
                  "合并移除蒙版",
                  renderMaskPreview(combined, imageWidth, imageHeight)
                ),
                await artifact(
                  `${parent.id}-removal-prepared`,
                  "羽化后修复蒙版",
                  renderMaskPreview(repairMask, imageWidth, imageHeight)
                ),
                await artifact(
                  `${parent.id}-removal-overlay`,
                  "原图叠加",
                  renderOverlayPreview(image, repairMask, imageWidth, imageHeight, [255, 148, 96])
                )
              ]
              : []
          });
        } catch (exception) {
          failStage(maskStage, exception);
          throw exception;
        }

        const repairStage = beginStage("本地背景修复", scope);
        try {
          if (maskStats(repairMask).area <= 0) {
            finishStage(repairStage, { status: "skipped", summary: "修复蒙版为空，直接使用原图背景" });
          } else {
            const autoDiffusion = shouldForceManualDiffusion(parent, children.length > 0);
            const forceDiffusion = input.repairMode === "diffusion"
              ? true
              : input.repairMode === "model" ? false : autoDiffusion;
            if (!forceDiffusion && resources.value.repair !== "ready") {
              throw new Error("Big-LaMa 修复模型未就绪，请先在 AI 抠图页下载修复模型或改用强制扩散。");
            }
            const contextBounds = alphaContentBounds(parentAlpha, imageWidth, imageHeight, parent);
            const beforeUrl = await artifact(
              `${parent.id}-repair-before`,
              "修复前",
              renderImagePreview(image, imageWidth, imageHeight)
            );
            const repaired = await repairBackgroundLocally(
              image,
              imageWidth,
              imageHeight,
              repairMask,
              parentAlpha,
              parent,
              { signal: controller.signal, forceDiffusion }
            );
            const exported = await maskToTransparentPng(
              repaired,
              imageWidth,
              imageHeight,
              parentAlpha,
              parent
            );
            finishStage(repairStage, {
              summary: forceDiffusion
                ? "确定性二维调和扩散填充蒙版区域"
                : "Big-LaMa 生成式修复（超尺寸时按 512×512 瓦片分块）",
              metrics: [
                { label: "分流决策", value: forceDiffusion ? "扩散" : "Big-LaMa" },
                { label: "自动规则判定", value: autoDiffusion ? "扩散" : "模型" },
                { label: "修复上下文", value: `${contextBounds.x}, ${contextBounds.y} · ${contextBounds.width}×${contextBounds.height}` },
                { label: "输出尺寸", value: `${exported.width}×${exported.height}` }
              ],
              artifacts: [
                beforeUrl,
                await artifact(
                  `${parent.id}-repair-after`,
                  "修复后整图",
                  renderImagePreview(repaired, imageWidth, imageHeight)
                ),
                await artifact(
                  `${parent.id}-repair-background`,
                  "背景素材",
                  Promise.resolve(blobPreviewUrl(exported.blob))
                )
              ]
            });
          }
        } catch (exception) {
          failStage(repairStage, exception);
          throw exception;
        }
      }

      // 6. 合并前景：复合对象（多个素材选区）一次性导出单张透明 PNG。
      const extractSelections = selections.filter((item) => item.behavior === "extract");
      if (extractSelections.length >= 2) {
        const unionStage = beginStage("合并前景导出", "");
        try {
          const alphas = extractSelections
            .map((item) => refinedMasks.get(item.id))
            .filter((mask): mask is Uint8Array => Boolean(mask));
          const unionAlpha = unionMasks(alphas);
          const fullSelection: CutoutSelection = {
            id: "debug-union",
            x: 0,
            y: 0,
            width: imageWidth,
            height: imageHeight,
            behavior: "extract",
            parentId: null,
            relationSource: "auto",
            removalStrokes: []
          };
          const exported = await maskToTransparentPng(
            image,
            imageWidth,
            imageHeight,
            unionAlpha,
            fullSelection
          );
          finishStage(unionStage, {
            summary: `合并 ${alphas.length} 个素材选区 Alpha，输出单张透明 PNG`,
            metrics: [
              { label: "合并选区", value: String(alphas.length) },
              { label: "输出尺寸", value: `${exported.width}×${exported.height}` },
              { label: "文件大小", value: `${(exported.blob.size / 1024).toFixed(1)} KB` }
            ],
            artifacts: [
              await artifact(
                "union-material",
                "合并透明素材",
                Promise.resolve(blobPreviewUrl(exported.blob))
              ),
              await artifact(
                "union-checker",
                "棋盘合成预览",
                renderAlphaCompositePreview(image, unionAlpha, imageWidth, imageHeight)
              )
            ]
          });
        } catch (exception) {
          failStage(unionStage, exception);
          throw exception;
        }
      }
    } catch (exception) {
      error.value = controller.signal.aborted
        ? "调试流程已取消。"
        : exception instanceof Error
          ? exception.message
          : typeof exception === "string" && exception.trim()
            ? exception.trim()
            : "调试流程执行失败。";
    } finally {
      totalDurationMs.value = performance.now() - startedAt;
      running.value = false;
      abortController.value = null;
      await refreshResources().catch(() => undefined);
    }
  }

  void refreshResources().catch(() => undefined);

  onBeforeUnmount(() => {
    abortController.value?.abort();
    void releaseInferenceSession().catch(() => undefined);
    releaseUrls();
  });

  return {
    stages: readonly(stages),
    running: readonly(running),
    error: readonly(error),
    totalDuration: readonly(totalDurationMs),
    resources: readonly(resources),
    localModelsSupported,
    formatDuration,
    refreshResources,
    reset,
    run,
    cancel
  };
}
