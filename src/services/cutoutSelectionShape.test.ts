import { describe, expect, it } from "vitest";
import {
  constrainAlphaToSelection,
  cutoutPolygonBounds,
  pointInCutoutPolygon,
  rasterizeCutoutPolygon
} from "@/services/cutoutSelectionShape";
import type { CutoutSelection } from "@/types";

const polygon = [
  { x: 1, y: 1 },
  { x: 4, y: 1 },
  { x: 1, y: 4 }
];

function polygonSelection(): CutoutSelection {
  return {
    id: "polygon",
    x: 1,
    y: 1,
    width: 3,
    height: 3,
    polygon,
    behavior: "extract",
    parentId: null,
    relationSource: "auto",
    removalStrokes: []
  };
}

describe("cutoutSelectionShape", () => {
  it("calculates a polygon bounding box", () => {
    expect(cutoutPolygonBounds(polygon)).toEqual({ x: 1, y: 1, width: 3, height: 3 });
  });

  it("distinguishes points inside and outside a concave-safe polygon test", () => {
    expect(pointInCutoutPolygon({ x: 1.5, y: 1.5 }, polygon)).toBe(true);
    expect(pointInCutoutPolygon({ x: 3.5, y: 3.5 }, polygon)).toBe(false);
  });

  it("fills the polygon interior for use as a model-output constraint", () => {
    const alpha = rasterizeCutoutPolygon(6, 6, [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 5 },
      { x: 1, y: 5 }
    ]);
    expect(alpha[2 * 6 + 2]).toBe(255);
    expect(alpha[3 * 6 + 3]).toBe(255);
    expect(alpha[0]).toBe(0);
    expect(alpha[5 * 6 + 5]).toBe(0);
  });

  it("antialiases sloped polygon constraint edges", () => {
    const alpha = rasterizeCutoutPolygon(5, 5, polygon);
    expect(alpha[2 * 5 + 1]).toBe(255);
    expect(alpha[2 * 5 + 2]).toBeGreaterThan(0);
    expect(alpha[2 * 5 + 2]).toBeLessThan(255);
    expect(alpha[3 * 5 + 3]).toBe(0);
  });

  it("zeros alpha outside the manual outline without mutating the model mask", () => {
    const alpha = new Uint8Array(25).fill(255);
    const constrained = constrainAlphaToSelection(alpha, 5, 5, polygonSelection());
    expect(constrained[1 * 5 + 1]).toBe(255);
    expect(constrained[3 * 5 + 3]).toBe(0);
    expect(constrained[0]).toBe(0);
    expect(alpha.every((value) => value === 255)).toBe(true);
  });

  it("returns the existing alpha for a rectangular selection", () => {
    const selection = polygonSelection();
    delete selection.polygon;
    const alpha = new Uint8Array(4).fill(200);
    expect(constrainAlphaToSelection(alpha, 2, 2, selection)).toBe(alpha);
  });
});
