export interface ScoredCutoutMask {
  score: number;
  alpha: Uint8Array;
}

const NEAR_TIE_SCORE_DELTA = 0.001;
const MIN_SOLID_AREA_GAIN = 1.02;
const SOLID_ALPHA_THRESHOLD = 128;
const FOOTPRINT_ALPHA_THRESHOLD = 32;
const AUTO_LAYER_MIN_FALLBACK_SCORE = 0.82;
const AUTO_LAYER_MIN_SOLID_GAIN = 1.08;
const AUTO_LAYER_MIN_OPACITY_GAIN = 0.03;
const AUTO_LAYER_MAX_BOUNDS_DELTA = 0.08;
const AUTO_LAYER_EXPORT_ALPHA_THRESHOLD = 8;

function solidMaskArea(alpha: Uint8Array): number {
  let area = 0;
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] >= SOLID_ALPHA_THRESHOLD) area += 1;
  }
  return area;
}

interface MaskCoverageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function expandAutoLayerSegmentationBox<T extends MaskCoverageRegion>(
  region: T,
  imageWidth: number,
  imageHeight: number
): T {
  const padding = clamp(Math.round(Math.max(region.width, region.height) * 0.08), 8, 32);
  const left = clamp(Math.floor(region.x) - padding, 0, imageWidth - 1);
  const top = clamp(Math.floor(region.y) - padding, 0, imageHeight - 1);
  const right = clamp(Math.ceil(region.x + region.width) + padding, left + 1, imageWidth);
  const bottom = clamp(Math.ceil(region.y + region.height) + padding, top + 1, imageHeight);
  return { ...region, x: left, y: top, width: right - left, height: bottom - top };
}

export function expandAutoLayerMaterialBox<T extends MaskCoverageRegion>(
  alpha: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  region: T
): T {
  if (alpha.length !== imageWidth * imageHeight) {
    throw new Error("素材遮罩尺寸与图片不匹配。");
  }
  const left = clamp(Math.floor(region.x), 0, imageWidth - 1);
  const top = clamp(Math.floor(region.y), 0, imageHeight - 1);
  const right = clamp(Math.ceil(region.x + region.width), left + 1, imageWidth);
  const bottom = clamp(Math.ceil(region.y + region.height), top + 1, imageHeight);
  const padding = clamp(Math.round(Math.max(region.width, region.height) * 0.08), 8, 32);
  const edgeBand = clamp(Math.round(Math.min(region.width, region.height) * 0.01), 1, 3);

  const verticalThreshold = Math.max(2, Math.floor((bottom - top) * 0.02));
  const horizontalThreshold = Math.max(2, Math.floor((right - left) * 0.02));
  let leftHits = 0;
  let rightHits = 0;
  let topHits = 0;
  let bottomHits = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let offset = 0; offset < edgeBand; offset += 1) {
      if (alpha[y * imageWidth + Math.min(right - 1, left + offset)] >= AUTO_LAYER_EXPORT_ALPHA_THRESHOLD) leftHits += 1;
      if (alpha[y * imageWidth + Math.max(left, right - 1 - offset)] >= AUTO_LAYER_EXPORT_ALPHA_THRESHOLD) rightHits += 1;
    }
  }
  for (let x = left; x < right; x += 1) {
    for (let offset = 0; offset < edgeBand; offset += 1) {
      if (alpha[Math.min(bottom - 1, top + offset) * imageWidth + x] >= AUTO_LAYER_EXPORT_ALPHA_THRESHOLD) topHits += 1;
      if (alpha[Math.max(top, bottom - 1 - offset) * imageWidth + x] >= AUTO_LAYER_EXPORT_ALPHA_THRESHOLD) bottomHits += 1;
    }
  }

  let expandedLeft = left;
  let expandedTop = top;
  let expandedRight = right;
  let expandedBottom = bottom;
  const searchLeft = Math.max(0, left - padding);
  const searchTop = Math.max(0, top - padding);
  const searchRight = Math.min(imageWidth, right + padding);
  const searchBottom = Math.min(imageHeight, bottom + padding);
  for (let y = searchTop; y < searchBottom; y += 1) {
    for (let x = searchLeft; x < searchRight; x += 1) {
      if (alpha[y * imageWidth + x] < AUTO_LAYER_EXPORT_ALPHA_THRESHOLD) continue;
      if (leftHits >= verticalThreshold && x < left) expandedLeft = Math.min(expandedLeft, x);
      if (rightHits >= verticalThreshold && x >= right) expandedRight = Math.max(expandedRight, x + 1);
      if (topHits >= horizontalThreshold && y < top) expandedTop = Math.min(expandedTop, y);
      if (bottomHits >= horizontalThreshold && y >= bottom) expandedBottom = Math.max(expandedBottom, y + 1);
    }
  }
  return {
    ...region,
    x: expandedLeft,
    y: expandedTop,
    width: expandedRight - expandedLeft,
    height: expandedBottom - expandedTop
  };
}

function maskCoverage(alpha: Uint8Array, imageWidth: number, region: MaskCoverageRegion) {
  let footprint = 0;
  let solid = 0;
  let minX = imageWidth;
  let maxX = -1;
  let minY = Math.ceil(alpha.length / imageWidth);
  let maxY = -1;
  const imageHeight = Math.ceil(alpha.length / imageWidth);
  const left = Math.max(0, Math.floor(region.x));
  const top = Math.max(0, Math.floor(region.y));
  const right = Math.min(imageWidth, Math.ceil(region.x + region.width));
  const bottom = Math.min(imageHeight, Math.ceil(region.y + region.height));
  for (let y = top; y < bottom; y += 1) {
    const row = y * imageWidth;
    for (let x = left; x < right; x += 1) {
      const value = alpha[row + x];
      if (value >= FOOTPRINT_ALPHA_THRESHOLD) footprint += 1;
      if (value >= SOLID_ALPHA_THRESHOLD) solid += 1;
      if (value < FOOTPRINT_ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const boundsArea = maxX < 0 ? 0 : (maxX - minX + 1) * (maxY - minY + 1);
  return { footprint, solid, boundsArea, opacity: solid / Math.max(1, footprint) };
}

/**
 * 单个独立元素中，SAM 候选分数近似打平时优先保留明显更完整的主体。
 * 较大的分数差仍完全服从模型评分，避免改变多粒度候选的正常语义。
 */
export function chooseSingleElementMaskCandidate<T extends ScoredCutoutMask>(
  candidates: readonly T[]
): T | null {
  if (!candidates.length) return null;

  let highestScoreCandidate = candidates[0];
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index].score > highestScoreCandidate.score) {
      highestScoreCandidate = candidates[index];
    }
  }

  const highestScoreArea = solidMaskArea(highestScoreCandidate.alpha);
  let largestNearTieCandidate = highestScoreCandidate;
  let largestNearTieArea = highestScoreArea;
  for (const candidate of candidates) {
    if (highestScoreCandidate.score - candidate.score > NEAR_TIE_SCORE_DELTA) continue;
    const area = solidMaskArea(candidate.alpha);
    if (area > largestNearTieArea) {
      largestNearTieCandidate = candidate;
      largestNearTieArea = area;
    }
  }

  return largestNearTieArea >= highestScoreArea * MIN_SOLID_AREA_GAIN
    ? largestNearTieCandidate
    : highestScoreCandidate;
}

/**
 * UI 复合元素偶尔会出现“候选轮廓相同，但最高分候选把内部图标挖空”的情况。
 * 仅当另一候选的弱响应足迹几乎一致、实心覆盖显著更完整且自身评分仍可靠时回退，
 * 避免把更大但语义不同的 SAM 粒度误当成完整素材。
 */
export function chooseAutoLayerElementMaskCandidate<T extends ScoredCutoutMask>(
  candidates: readonly T[],
  imageWidth: number,
  region: MaskCoverageRegion
): T | null {
  if (!candidates.length) return null;
  let highest = candidates[0];
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index].score > highest.score) highest = candidates[index];
  }
  const baseline = maskCoverage(highest.alpha, imageWidth, region);
  let fallback = highest;
  let fallbackCoverage = baseline;
  for (const candidate of candidates) {
    if (candidate === highest || candidate.score < AUTO_LAYER_MIN_FALLBACK_SCORE) continue;
    const coverage = maskCoverage(candidate.alpha, imageWidth, region);
    const boundsRatio = coverage.boundsArea / Math.max(1, baseline.boundsArea);
    if (Math.abs(1 - boundsRatio) > AUTO_LAYER_MAX_BOUNDS_DELTA) continue;
    if (coverage.solid < baseline.solid * AUTO_LAYER_MIN_SOLID_GAIN) continue;
    if (coverage.opacity < baseline.opacity + AUTO_LAYER_MIN_OPACITY_GAIN) continue;
    if (coverage.solid > fallbackCoverage.solid || (
      coverage.solid === fallbackCoverage.solid && candidate.score > fallback.score
    )) {
      fallback = candidate;
      fallbackCoverage = coverage;
    }
  }
  return fallback;
}
