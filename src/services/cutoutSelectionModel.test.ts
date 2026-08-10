import { describe, expect, it } from "vitest";
import {
  applyAutomaticNesting,
  cloneCutoutSelections,
  resolveAutoLayerHierarchy,
  selectionDescendants,
  setSelectionIndependent,
  translateCutoutSelection
} from "@/services/cutoutSelectionModel";
import type { CutoutSelection, CutoutSelectionBox } from "@/types";

function box(id: string, x: number, y: number, width: number, height: number): CutoutSelectionBox {
  return { id, x, y, width, height };
}

function byId(selections: CutoutSelection[], id: string) {
  const selection = selections.find((item) => item.id === id);
  if (!selection) throw new Error(`missing selection ${id}`);
  return selection;
}

describe("applyAutomaticNesting", () => {
  it("preserves automatic-layer text selection kind while cloning", () => {
    const [selection] = cloneCutoutSelections([{
      id: "text", x: 1, y: 2, width: 30, height: 12,
      layerKind: "text", behavior: "extract", parentId: null,
      relationSource: "manual", removalStrokes: []
    }]);
    expect(selection.layerKind).toBe("text");
  });
  it("keeps unrelated boxes as independent foregrounds", () => {
    const result = applyAutomaticNesting([
      box("a", 0, 0, 20, 20),
      box("b", 30, 30, 20, 20)
    ]);
    expect(result.every((item) => item.parentId === null && item.behavior === "extract")).toBe(true);
  });

  it("is independent of draw order and chooses the smallest direct parent", () => {
    const input = [
      box("inner", 20, 20, 20, 20),
      box("outer", 0, 0, 100, 100),
      box("middle", 10, 10, 70, 70)
    ];
    for (const ordered of [input, [...input].reverse()]) {
      const result = applyAutomaticNesting(ordered);
      expect(byId(result, "inner").parentId).toBe("middle");
      expect(byId(result, "middle").parentId).toBe("outer");
      expect(byId(result, "outer").behavior).toBe("background");
      expect(byId(result, "middle").behavior).toBe("background");
      expect(byId(result, "inner").behavior).toBe("extract");
    }
  });

  it("requires 95 percent containment and an area below 80 percent", () => {
    const passes = applyAutomaticNesting([
      box("parent", 0, 0, 100, 100),
      box("child", -1, 10, 20, 20)
    ]);
    expect(byId(passes, "child").parentId).toBe("parent");

    const overlapOnly = applyAutomaticNesting([
      box("parent", 0, 0, 100, 100),
      box("child", -2, 10, 20, 20)
    ]);
    expect(byId(overlapOnly, "child").parentId).toBeNull();

    const tooLarge = applyAutomaticNesting([
      box("parent", 0, 0, 100, 100),
      box("child", 1, 1, 90, 90)
    ]);
    expect(byId(tooLarge, "child").parentId).toBeNull();
  });

  it("supports multiple direct children", () => {
    const result = applyAutomaticNesting([
      box("parent", 0, 0, 100, 100),
      box("left", 10, 10, 20, 20),
      box("right", 60, 60, 20, 20)
    ]);
    expect(result.filter((item) => item.parentId === "parent").map((item) => item.id).sort())
      .toEqual(["left", "right"]);
    expect(byId(result, "parent").behavior).toBe("background");
  });

  it("returns every nested descendant without including siblings or the parent", () => {
    const result = applyAutomaticNesting([
      box("outer", 0, 0, 120, 120),
      box("middle", 10, 10, 80, 80),
      box("inner", 20, 20, 20, 20),
      box("sibling", 150, 0, 20, 20)
    ]);

    expect(selectionDescendants(result, "outer").map(selection => selection.id))
      .toEqual(["middle", "inner"]);
    expect(selectionDescendants(result, "middle").map(selection => selection.id))
      .toEqual(["inner"]);
  });

  it("supports a small auto-layer edge tolerance without treating partial overlaps as nesting", () => {
    const tolerated = applyAutomaticNesting([
      box("parent", 10, 10, 100, 100),
      box("child", 7, 40, 30, 30)
    ], { edgeToleranceRatio: 0.1 });
    expect(byId(tolerated, "child").parentId).toBe("parent");

    const overlap = applyAutomaticNesting([
      box("parent", 10, 10, 100, 100),
      box("child", 0, 40, 30, 30)
    ], { edgeToleranceRatio: 0.1 });
    expect(byId(overlap, "child").parentId).toBeNull();
  });

  it("never assigns a text selection as a parent", () => {
    const result = applyAutomaticNesting([
      { ...box("text", 0, 0, 100, 100), layerKind: "text" },
      box("icon", 10, 10, 20, 20)
    ]);
    expect(byId(result, "icon").parentId).toBeNull();
  });

  it("preserves geometry-based text children after element Alpha validation", () => {
    const nested = applyAutomaticNesting([
      box("panel", 0, 0, 100, 100),
      { ...box("label", 20, 20, 40, 16), layerKind: "text" }
    ]);
    const validatedElements = cloneCutoutSelections([byId(nested, "panel")]).map(selection => ({
      ...selection,
      behavior: "extract" as const
    }));

    const resolved = resolveAutoLayerHierarchy(nested, validatedElements);

    expect(byId(resolved, "label").parentId).toBe("panel");
    expect(byId(resolved, "panel").behavior).toBe("background");
  });

  it("uses validated element relations and rejects corrupt hierarchy cycles", () => {
    const input = cloneCutoutSelections([
      { ...box("parent", 0, 0, 100, 100), parentId: "child" },
      { ...box("child", 10, 10, 20, 20), parentId: "parent" }
    ]);
    const validatedElements = cloneCutoutSelections(input).map(selection => selection.id === "child"
      ? {
        ...selection,
        parentId: null,
        behavior: "extract" as const,
        relationSource: "manual" as const
      }
      : selection);

    const resolved = resolveAutoLayerHierarchy(input, validatedElements);

    expect(byId(resolved, "child")).toMatchObject({
      parentId: null,
      behavior: "extract",
      relationSource: "manual"
    });
    expect(byId(resolved, "parent").parentId).toBe("child");
  });

  it("does not overwrite a manual independent selection", () => {
    const nested = applyAutomaticNesting([
      box("parent", 0, 0, 100, 100),
      box("child", 10, 10, 20, 20)
    ]);
    const manual = setSelectionIndependent(nested, "parent");
    const recomputed = applyAutomaticNesting(manual);
    expect(byId(recomputed, "parent")).toMatchObject({
      behavior: "extract",
      relationSource: "manual",
      parentId: null
    });
    expect(byId(recomputed, "child").parentId).toBeNull();
  });

  it("demotes an automatic parent when its only child becomes independent", () => {
    const nested = applyAutomaticNesting([
      box("parent", 0, 0, 100, 100),
      box("child", 10, 10, 20, 20)
    ]);
    const manual = setSelectionIndependent(nested, "child");
    expect(byId(manual, "child")).toMatchObject({
      behavior: "extract",
      relationSource: "manual",
      parentId: null
    });
    expect(byId(manual, "parent")).toMatchObject({
      behavior: "extract",
      relationSource: "auto",
      parentId: null
    });
    expect(byId(applyAutomaticNesting(manual), "child").parentId).toBeNull();
  });

  it("moves a selection within image bounds and recalculates nesting", () => {
    const nested = applyAutomaticNesting([
      box("parent", 0, 0, 100, 100),
      box("child", 10, 10, 20, 20)
    ]);
    const moved = translateCutoutSelection(nested, "child", 190, -5, 200, 200);
    expect(byId(moved, "child")).toMatchObject({
      x: 180,
      y: 0,
      parentId: null,
      behavior: "extract"
    });
    expect(byId(moved, "parent").behavior).toBe("extract");
  });

  it("clones and translates a manual polygon with its bounding box", () => {
    const [selection] = cloneCutoutSelections([{
      ...box("polygon", 10, 20, 30, 40),
      polygon: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 20, y: 60 }],
      behavior: "extract",
      parentId: null,
      relationSource: "auto",
      removalStrokes: []
    }]);
    const moved = translateCutoutSelection([selection], "polygon", 25, 35, 200, 200, false);
    expect(moved[0].polygon).toEqual([
      { x: 25, y: 35 },
      { x: 55, y: 35 },
      { x: 35, y: 75 }
    ]);
    expect(selection.polygon?.[0]).toEqual({ x: 10, y: 20 });
  });
});
