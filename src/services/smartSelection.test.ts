import { describe, expect, it } from "vitest";
import {
  createSmartSelectionPointGrid,
  normalizeSmartSelectionProposals,
  normalizeSmartSelectionThreshold
} from "@/services/smartSelection";

function proposal(overrides: Partial<{
  confidence: number;
  predictedIou: number;
  stability: number;
  x: number;
  y: number;
  width: number;
  height: number;
}> = {}) {
  return {
    confidence: 0.85,
    predictedIou: 0.9,
    stability: 0.95,
    x: 10,
    y: 10,
    width: 30,
    height: 30,
    ...overrides
  };
}

describe("SAM 2 smart selection proposals", () => {
  it("creates an evenly centered 12 by 12 point grid", () => {
    const points = createSmartSelectionPointGrid(1200, 600);

    expect(points).toHaveLength(144);
    expect(points[0]).toEqual({ x: 50, y: 25, label: 1 });
    expect(points.at(-1)).toEqual({ x: 1150, y: 575, label: 1 });
  });

  it("removes duplicate boxes while retaining meaningfully nested regions", () => {
    const result = normalizeSmartSelectionProposals([
      proposal({ confidence: 0.94, x: 10, y: 10, width: 80, height: 80 }),
      proposal({ confidence: 0.88, x: 12, y: 12, width: 78, height: 78 }),
      proposal({ confidence: 0.82, x: 30, y: 30, width: 20, height: 20 }),
      proposal({ confidence: 0.76, x: 34, y: 34, width: 10, height: 10 })
    ], 100, 100);

    expect(result).toHaveLength(3);
    expect(result.map(item => ({ x: item.x, y: item.y, width: item.width, height: item.height }))).toEqual([
      { x: 2, y: 2, width: 96, height: 96 },
      { x: 22, y: 22, width: 36, height: 36 },
      { x: 26, y: 26, width: 26, height: 26 }
    ]);
  });

  it("filters unstable, low-IoU and near-full-canvas proposals", () => {
    const result = normalizeSmartSelectionProposals([
      proposal({ predictedIou: 0.69 }),
      proposal({ stability: 0.79 }),
      proposal({ x: 0, y: 0, width: 100, height: 100 }),
      proposal({ confidence: 0.8, x: 10, y: 10, width: 30, height: 30 })
    ], 100, 100);

    expect(result).toEqual([
      expect.objectContaining({ x: 2, y: 2, width: 46, height: 46 })
    ]);
  });

  it("applies the user threshold and clamps it to the supported range", () => {
    const result = normalizeSmartSelectionProposals([
      proposal({ confidence: 0.9, predictedIou: 0.84, x: 10, y: 10 }),
      proposal({ confidence: 0.88, predictedIou: 0.9, x: 55, y: 55 })
    ], 100, 100, 0.85);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ x: 47, y: 47 }));
    expect(normalizeSmartSelectionThreshold(0.2)).toBe(0.8);
    expect(normalizeSmartSelectionThreshold(1)).toBe(0.99);
    expect(normalizeSmartSelectionThreshold(Number.NaN)).toBe(0.95);
  });

  it("expands edge proposals without leaving the image", () => {
    const result = normalizeSmartSelectionProposals([
      proposal({ confidence: 0.9, x: 2, y: 4, width: 40, height: 20 }),
      proposal({ confidence: 0.8, x: 70, y: 72, width: 28, height: 26 })
    ], 100, 100);

    expect(result.map(item => ({ x: item.x, y: item.y, width: item.width, height: item.height }))).toEqual([
      { x: 0, y: 0, width: 50, height: 32 },
      { x: 62, y: 64, width: 38, height: 36 }
    ]);
  });
});
