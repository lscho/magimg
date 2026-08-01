export interface ScoredCutoutMask {
  score: number;
  alpha: Uint8Array;
}

const NEAR_TIE_SCORE_DELTA = 0.001;
const MIN_SOLID_AREA_GAIN = 1.02;
const SOLID_ALPHA_THRESHOLD = 128;

function solidMaskArea(alpha: Uint8Array): number {
  let area = 0;
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] >= SOLID_ALPHA_THRESHOLD) area += 1;
  }
  return area;
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
