import { describe, expect, it } from "vitest";
import {
  buildRemovalMask,
  chooseSmartRemovalCandidate,
  prepareRepairMask,
  sampleStrokePoints
} from "@/services/cutoutRepairMask";
import type { CutoutRemovalStroke, CutoutSelectionBox } from "@/types";

const parent: CutoutSelectionBox = { id: "parent", x: 3, y: 3, width: 4, height: 4 };

function stroke(
  id: string,
  operation: "add" | "restore",
  radius: number,
  points: { x: number; y: number }[],
  smart = false
): CutoutRemovalStroke {
  return { id, operation, radius, points, smart };
}

describe("repair masks", () => {
  it("samples long smart strokes to at most eight evenly distributed points", () => {
    const points = Array.from({ length: 25 }, (_, x) => ({ x, y: x }));
    const sampled = sampleStrokePoints(stroke("s", "add", 2, points, true));
    expect(sampled).toHaveLength(8);
    expect(sampled[0]).toEqual(points[0]);
    expect(sampled[7]).toEqual(points[24]);
  });

  it("clips manual paint to the parent and subtracts restore strokes", () => {
    const width = 10;
    const height = 10;
    const parentAlpha = new Uint8Array(width * height).fill(255);
    const mask = buildRemovalMask({
      width,
      height,
      parent,
      parentAlpha,
      childAlphas: [],
      strokes: [
        stroke("add", "add", 4, [{ x: 3, y: 3 }]),
        stroke("restore", "restore", 1, [{ x: 4, y: 4 }])
      ],
      smartMasks: new Map()
    });
    expect(mask[0]).toBe(0);
    expect(mask[3 * width + 6]).toBeGreaterThan(0);
    expect(mask[4 * width + 4]).toBe(0);
    expect(mask[7 * width + 7]).toBe(0);
  });

  it("combines child alpha and keeps pixels outside parent alpha untouched", () => {
    const width = 4;
    const height = 4;
    const child = new Uint8Array(width * height);
    child[5] = 255;
    child[10] = 255;
    const parentAlpha = new Uint8Array(width * height);
    parentAlpha[5] = 255;
    const mask = buildRemovalMask({
      width,
      height,
      parent: { id: "p", x: 0, y: 0, width, height },
      parentAlpha,
      childAlphas: [child],
      strokes: [],
      smartMasks: new Map()
    });
    expect(mask[5]).toBe(255);
    expect(mask[10]).toBe(0);
  });

  it("dilates and feathers while preserving the original removal pixel", () => {
    const mask = new Uint8Array(11 * 11);
    mask[5 * 11 + 5] = 255;
    const prepared = prepareRepairMask(mask, 11, 11);
    expect(prepared[5 * 11 + 5]).toBe(255);
    expect(prepared[5 * 11 + 8]).toBeGreaterThan(0);
    expect(prepared[0]).toBe(0);
  });

  it("clips dilation and feathering back to the active selection", () => {
    const width = 12;
    const height = 12;
    const mask = new Uint8Array(width * height);
    mask[4 * width + 4] = 255;
    const prepared = prepareRepairMask(mask, width, height, {
      id: "active",
      x: 4,
      y: 4,
      width: 4,
      height: 4
    });
    expect(prepared[4 * width + 4]).toBe(255);
    expect(prepared[4 * width + 3]).toBe(0);
    expect(prepared[3 * width + 4]).toBe(0);
  });

  it("rejects smart candidates that cover most of the parent", () => {
    const width = 10;
    const height = 10;
    const huge = new Uint8Array(width * height).fill(255);
    const focused = new Uint8Array(width * height);
    focused[5 * width + 5] = 255;
    const selected = chooseSmartRemovalCandidate([
      { score: 0.99, alpha: huge },
      { score: 0.8, alpha: focused }
    ], [{ x: 5, y: 5 }], width, height, {
      id: "p", x: 0, y: 0, width, height
    });
    expect(selected).toEqual(focused);
  });
});
