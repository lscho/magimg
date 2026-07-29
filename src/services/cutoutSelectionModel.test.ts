import { describe, expect, it } from "vitest";
import {
  applyAutomaticNesting,
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
});
