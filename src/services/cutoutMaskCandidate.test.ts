import { describe, expect, it } from "vitest";
import {
  chooseAutoLayerElementMaskCandidate,
  chooseSingleElementMaskCandidate,
  createCandidateConsensusAlpha,
  expandAutoLayerMaterialBox,
  expandAutoLayerSegmentationBox,
  restoreRefinedAlphaFromCandidateSupport
} from "@/services/cutoutMaskCandidate";

function candidate(score: number, solidPixels: number, totalPixels = 10) {
  const alpha = new Uint8Array(totalPixels);
  alpha.fill(255, 0, solidPixels);
  return { score, alpha };
}

describe("single element cutout candidate selection", () => {
  it("keeps the highest IoU candidate when the score gap is meaningful", () => {
    const highest = candidate(0.95, 5);
    const larger = candidate(0.94, 9);

    expect(chooseSingleElementMaskCandidate([highest, larger])).toBe(highest);
  });

  it("prefers a visibly more complete mask when IoU scores are effectively tied", () => {
    const highest = candidate(0.99438, 7);
    const complete = candidate(0.994154, 9);

    expect(chooseSingleElementMaskCandidate([highest, complete])).toBe(complete);
  });

  it("keeps the highest score when the near-tie area gain is negligible", () => {
    const highest = candidate(0.91, 100, 200);
    const marginallyLarger = candidate(0.9095, 101, 200);

    expect(chooseSingleElementMaskCandidate([highest, marginallyLarger])).toBe(highest);
  });

  it("returns null when the decoder has no candidates", () => {
    expect(chooseSingleElementMaskCandidate([])).toBeNull();
  });
});

describe("auto layer element candidate selection", () => {
  it("uses a reliable opaque candidate when the highest score has a large internal hole", () => {
    const partial = candidate(0.96, 40, 100);
    partial.alpha.fill(64, 40, 90);
    const complete = candidate(0.86, 68, 100);
    complete.alpha.fill(64, 68, 88);

    expect(chooseAutoLayerElementMaskCandidate(
      [partial, complete], 10, { x: 0, y: 0, width: 10, height: 10 }
    )).toBe(complete);
  });

  it("does not use a low confidence larger candidate", () => {
    const highest = candidate(0.96, 40, 100);
    highest.alpha.fill(64, 40, 90);
    const unreliable = candidate(0.72, 70, 100);
    unreliable.alpha.fill(64, 70, 90);

    expect(chooseAutoLayerElementMaskCandidate(
      [highest, unreliable], 10, { x: 0, y: 0, width: 10, height: 10 }
    )).toBe(highest);
  });

  it("does not replace a candidate with a different footprint", () => {
    const highest = candidate(0.96, 40, 100);
    const differentGranularity = candidate(0.9, 75, 100);

    expect(chooseAutoLayerElementMaskCandidate(
      [highest, differentGranularity], 10, { x: 0, y: 0, width: 10, height: 10 }
    )).toBe(highest);
  });

  it("accepts a moderately more complete candidate with the same footprint", () => {
    const highest = candidate(0.95, 40, 100);
    highest.alpha.fill(64, 40, 90);
    const complete = candidate(0.86, 44, 100);
    complete.alpha.fill(64, 44, 90);

    expect(chooseAutoLayerElementMaskCandidate(
      [highest, complete], 10, { x: 0, y: 0, width: 10, height: 10 }
    )).toBe(complete);
  });

  it("expands export bounds only where refined alpha continues beyond a tight box", () => {
    const width = 24;
    const height = 20;
    const alpha = new Uint8Array(width * height);
    for (let y = 6; y < 14; y += 1) alpha.fill(255, y * width + 6, y * width + 17);

    expect(expandAutoLayerMaterialBox(alpha, width, height, {
      x: 6, y: 6, width: 10, height: 8
    })).toEqual({ x: 6, y: 6, width: 11, height: 8 });
  });

  it("adds bounded segmentation context around tightly drawn element boxes", () => {
    expect(expandAutoLayerSegmentationBox(
      { x: 40, y: 30, width: 200, height: 250 },
      320,
      400
    )).toEqual({ x: 20, y: 10, width: 240, height: 290 });
  });

  it("clamps segmentation context at image edges", () => {
    expect(expandAutoLayerSegmentationBox(
      { x: 2, y: 3, width: 80, height: 100 },
      100,
      120
    )).toEqual({ x: 0, y: 0, width: 90, height: 111 });
  });
});

describe("polygon element alpha recovery", () => {
  const width = 7;
  const height = 7;

  function solidSquare() {
    const alpha = new Uint8Array(width * height);
    for (let y = 1; y < 6; y += 1) alpha.fill(255, y * width + 1, y * width + 6);
    return alpha;
  }

  it("restores a model-supported hole enclosed by the refined silhouette", () => {
    const refined = solidSquare();
    refined[3 * width + 3] = 32;
    const support = solidSquare();

    const restored = restoreRefinedAlphaFromCandidateSupport(
      refined,
      support,
      createCandidateConsensusAlpha([support]),
      width,
      height,
      { x: 0, y: 0, width, height }
    );

    expect(restored[3 * width + 3]).toBe(255);
    expect(refined[3 * width + 3]).toBe(32);
  });

  it("preserves background connected to the exterior even when a candidate is broader", () => {
    const refined = solidSquare();
    for (let y = 0; y <= 3; y += 1) refined[y * width + 3] = 0;
    const support = solidSquare();

    const restored = restoreRefinedAlphaFromCandidateSupport(
      refined,
      support,
      createCandidateConsensusAlpha([support]),
      width,
      height,
      { x: 0, y: 0, width, height }
    );

    expect(restored[3 * width + 3]).toBe(0);
  });

  it("does not invent foreground where no SAM candidate provides support", () => {
    const refined = solidSquare();
    refined[3 * width + 3] = 0;
    const support = solidSquare();
    support[3 * width + 3] = 0;

    const restored = restoreRefinedAlphaFromCandidateSupport(
      refined,
      support,
      createCandidateConsensusAlpha([support]),
      width,
      height,
      { x: 0, y: 0, width, height }
    );

    expect(restored[3 * width + 3]).toBe(0);
  });

  it("restores an exterior-connected gap inside two-candidate consensus", () => {
    const refined = solidSquare();
    for (let y = 3; y < height; y += 1) refined[y * width + 3] = 0;
    const first = solidSquare();
    const second = solidSquare();
    const support = solidSquare();

    const restored = restoreRefinedAlphaFromCandidateSupport(
      refined,
      support,
      createCandidateConsensusAlpha([first, second]),
      width,
      height,
      { x: 0, y: 0, width, height }
    );

    expect(restored[3 * width + 3]).toBe(255);
  });

  it("does not restore an exterior-connected gap supported by only one candidate", () => {
    const refined = solidSquare();
    for (let y = 3; y < height; y += 1) refined[y * width + 3] = 0;
    const support = solidSquare();

    const restored = restoreRefinedAlphaFromCandidateSupport(
      refined,
      support,
      createCandidateConsensusAlpha([support]),
      width,
      height,
      { x: 0, y: 0, width, height }
    );

    expect(restored[3 * width + 3]).toBe(0);
  });

  it("preserves the consensus boundary while restoring its interior", () => {
    const refined = solidSquare();
    for (let y = 3; y < height; y += 1) refined[y * width + 3] = 0;
    const first = solidSquare();
    const second = solidSquare();
    const consensus = createCandidateConsensusAlpha([first, second]);

    const restored = restoreRefinedAlphaFromCandidateSupport(
      refined,
      first,
      consensus,
      width,
      height,
      { x: 0, y: 0, width, height }
    );

    expect(restored[3 * width + 3]).toBe(255);
    expect(restored[5 * width + 3]).toBe(0);
  });
});
