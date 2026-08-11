import {
  encodeCutoutImage,
  proposeCutoutMasks,
  type CutoutAutoProposal
} from "@/services/cutoutInference";
import { CUTOUT_MODEL } from "@/services/cutoutModelManager";
import type { CutoutPointPrompt, CutoutSelection } from "@/types";

export interface SmartSelectionProposal {
  confidence: number;
  predictedIou: number;
  stability: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const GRID_POINTS_PER_SIDE = 12;
const MAX_SMART_SELECTIONS = 32;
export const SMART_SELECTION_THRESHOLD_MIN = 0.80;
export const SMART_SELECTION_THRESHOLD_MAX = 0.99;
export const DEFAULT_SMART_SELECTION_THRESHOLD = 0.95;
const MIN_STABILITY_SCORE = 0.80;
const SELECTION_PADDING_RATIO = 0.08;
const MIN_SELECTION_PADDING = 8;
const MAX_SELECTION_PADDING = 32;
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface SmartSelectionOptions {
  minPredictedIou?: number;
}

export function normalizeSmartSelectionThreshold(value: number) {
  const finite = Number.isFinite(value) ? value : DEFAULT_SMART_SELECTION_THRESHOLD;
  return Math.round(Math.min(
    SMART_SELECTION_THRESHOLD_MAX,
    Math.max(SMART_SELECTION_THRESHOLD_MIN, finite)
  ) * 100) / 100;
}

function boxArea(box: SmartSelectionProposal) {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function intersectionArea(left: SmartSelectionProposal, right: SmartSelectionProposal) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function duplicateBox(candidate: SmartSelectionProposal, kept: readonly SmartSelectionProposal[]) {
  const candidateArea = boxArea(candidate);
  return kept.some(current => {
    const currentArea = boxArea(current);
    const intersection = intersectionArea(candidate, current);
    const union = candidateArea + currentArea - intersection;
    const iou = union > 0 ? intersection / union : 0;
    const smaller = Math.min(candidateArea, currentArea);
    const larger = Math.max(candidateArea, currentArea);
    const containment = smaller > 0 ? intersection / smaller : 0;
    return iou >= 0.78 || (containment >= 0.97 && smaller / Math.max(1, larger) >= 0.72);
  });
}

function expandProposalBox(
  proposal: SmartSelectionProposal,
  imageWidth: number,
  imageHeight: number
) {
  const padding = Math.round(Math.min(
    MAX_SELECTION_PADDING,
    Math.max(MIN_SELECTION_PADDING, Math.max(proposal.width, proposal.height) * SELECTION_PADDING_RATIO)
  ));
  const x = Math.max(0, proposal.x - padding);
  const y = Math.max(0, proposal.y - padding);
  const right = Math.min(imageWidth, proposal.x + proposal.width + padding);
  const bottom = Math.min(imageHeight, proposal.y + proposal.height + padding);
  return { ...proposal, x, y, width: right - x, height: bottom - y };
}

export function createSmartSelectionPointGrid(imageWidth: number, imageHeight: number) {
  const points: CutoutPointPrompt[] = [];
  for (let row = 0; row < GRID_POINTS_PER_SIDE; row += 1) {
    for (let column = 0; column < GRID_POINTS_PER_SIDE; column += 1) {
      points.push({
        x: (column + 0.5) * imageWidth / GRID_POINTS_PER_SIDE,
        y: (row + 0.5) * imageHeight / GRID_POINTS_PER_SIDE,
        label: 1
      });
    }
  }
  return points;
}

export function normalizeSmartSelectionProposals(
  proposals: readonly SmartSelectionProposal[],
  imageWidth: number,
  imageHeight: number,
  minPredictedIou = DEFAULT_SMART_SELECTION_THRESHOLD
) {
  const predictedIouThreshold = normalizeSmartSelectionThreshold(minPredictedIou);
  const imageArea = Math.max(1, imageWidth * imageHeight);
  const kept: SmartSelectionProposal[] = [];
  for (const proposal of [...proposals].sort((a, b) => b.confidence - a.confidence)) {
    const x = Math.max(0, Math.min(imageWidth - 1, Math.round(proposal.x)));
    const y = Math.max(0, Math.min(imageHeight - 1, Math.round(proposal.y)));
    const right = Math.max(x + 1, Math.min(imageWidth, Math.round(proposal.x + proposal.width)));
    const bottom = Math.max(y + 1, Math.min(imageHeight, Math.round(proposal.y + proposal.height)));
    const normalized = { ...proposal, x, y, width: right - x, height: bottom - y };
    const areaRatio = boxArea(normalized) / imageArea;
    if (!Number.isFinite(normalized.confidence) || normalized.predictedIou < predictedIouThreshold ||
      normalized.stability < MIN_STABILITY_SCORE || normalized.width < 6 || normalized.height < 6 ||
      areaRatio < 0.00008 || areaRatio > 0.92 || duplicateBox(normalized, kept)) continue;
    kept.push(normalized);
    if (kept.length >= MAX_SMART_SELECTIONS) break;
  }
  return kept.map(proposal => expandProposalBox(proposal, imageWidth, imageHeight));
}

function proposalInImageSpace(
  proposal: CutoutAutoProposal,
  scaleX: number,
  scaleY: number
): SmartSelectionProposal {
  return {
    ...proposal,
    x: proposal.x / scaleX,
    y: proposal.y / scaleY,
    width: proposal.width / scaleX,
    height: proposal.height / scaleY
  };
}

export async function detectSmartSelections(
  source: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  options: SmartSelectionOptions = {},
  signal?: AbortSignal
): Promise<CutoutSelection[]> {
  if (!isTauri) throw new Error("智能框选仅支持桌面客户端。");
  const minPredictedIou = normalizeSmartSelectionThreshold(
    options.minPredictedIou ?? DEFAULT_SMART_SELECTION_THRESHOLD
  );
  const embedding = await encodeCutoutImage(
    CUTOUT_MODEL,
    source,
    imageWidth,
    imageHeight,
    signal
  );
  const proposals = await proposeCutoutMasks(
    CUTOUT_MODEL,
    embedding,
    createSmartSelectionPointGrid(imageWidth, imageHeight),
    {
      minPredictedIou,
      minStabilityScore: MIN_STABILITY_SCORE
    },
    signal
  );
  return normalizeSmartSelectionProposals(
    proposals.map(proposal => proposalInImageSpace(proposal, embedding.scaleX, embedding.scaleY)),
    imageWidth,
    imageHeight,
    minPredictedIou
  ).map(proposal => ({
    id: `smart-selection-${crypto.randomUUID()}`,
    x: proposal.x,
    y: proposal.y,
    width: proposal.width,
    height: proposal.height,
    layerKind: "element",
    behavior: "extract",
    parentId: null,
    relationSource: "auto",
    removalStrokes: []
  }));
}
