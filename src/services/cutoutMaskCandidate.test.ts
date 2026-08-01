import { describe, expect, it } from "vitest";
import { chooseSingleElementMaskCandidate } from "@/services/cutoutMaskCandidate";

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
