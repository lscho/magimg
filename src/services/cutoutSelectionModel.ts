import type {
  CutoutRemovalStroke,
  CutoutSelection,
  CutoutSelectionBox
} from "@/types";

const MIN_CHILD_CONTAINMENT = 0.95;
const MAX_CHILD_AREA_RATIO = 0.8;

export interface AutomaticNestingOptions {
  /** Allows tightly aligned UI children to extend slightly beyond a selected parent edge. */
  edgeToleranceRatio?: number;
}

function cloneStroke(stroke: CutoutRemovalStroke): CutoutRemovalStroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({ ...point }))
  };
}

function clonePolygon(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const points = value
    .filter((point): point is { x: number; y: number } => Boolean(
      point && typeof point === "object" &&
      Number.isFinite((point as { x?: unknown }).x) &&
      Number.isFinite((point as { y?: unknown }).y)
    ))
    .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  return points.length >= 3 ? points : undefined;
}

export function normalizeCutoutSelection(
  selection: CutoutSelectionBox | Partial<CutoutSelection>
): CutoutSelection {
  const extended = selection as Partial<CutoutSelection>;
  return {
    id: String(selection.id),
    x: Number(selection.x),
    y: Number(selection.y),
    width: Number(selection.width),
    height: Number(selection.height),
    layerKind: extended.layerKind === "text" ? "text" : "element",
    polygon: clonePolygon(extended.polygon),
    behavior: extended.behavior === "background" ? "background" : "extract",
    parentId: typeof extended.parentId === "string" ? extended.parentId : null,
    relationSource: extended.relationSource === "manual" ? "manual" : "auto",
    removalStrokes: Array.isArray(extended.removalStrokes)
      ? extended.removalStrokes.map(cloneStroke)
      : []
  };
}

export function cloneCutoutSelections(
  selections: readonly (CutoutSelectionBox | CutoutSelection)[]
): CutoutSelection[] {
  return selections.map(normalizeCutoutSelection);
}

function boxArea(box: CutoutSelectionBox) {
  return Math.max(0, box.width) * Math.max(0, box.height);
}

function intersectionArea(a: CutoutSelectionBox, b: CutoutSelectionBox) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 建立最近父级；人工设为独立的选区不会被自动关系覆盖。 */
export function applyAutomaticNesting(
  input: readonly (CutoutSelectionBox | CutoutSelection)[],
  options: AutomaticNestingOptions = {}
): CutoutSelection[] {
  const selections = cloneCutoutSelections(input);
  const byId = new Map(selections.map((selection) => [selection.id, selection]));

  for (const child of selections) {
    if (child.relationSource === "manual" && child.parentId === null) continue;
    const childArea = boxArea(child);
    if (childArea <= 0) continue;
    const parent = selections
      .filter((candidate) => candidate.id !== child.id)
      .filter((candidate) => !(
        candidate.relationSource === "manual" && candidate.behavior === "extract"
      ))
      .filter((candidate) => candidate.layerKind !== "text")
      .filter((candidate) => {
        const parentArea = boxArea(candidate);
        const tolerance = options.edgeToleranceRatio
          ? clamp(Math.round(Math.min(child.width, child.height) * options.edgeToleranceRatio), 2, 12)
          : 0;
        const tolerantParent = tolerance > 0 ? {
          ...candidate,
          x: candidate.x - tolerance,
          y: candidate.y - tolerance,
          width: candidate.width + tolerance * 2,
          height: candidate.height + tolerance * 2
        } : candidate;
        return parentArea > 0 &&
          childArea / parentArea < MAX_CHILD_AREA_RATIO &&
          intersectionArea(child, tolerantParent) / childArea >= MIN_CHILD_CONTAINMENT;
      })
      .sort((a, b) => boxArea(a) - boxArea(b))[0];
    child.parentId = parent?.id ?? null;
    child.relationSource = "auto";
  }

  for (const selection of selections) {
    const hasChild = selections.some((candidate) => candidate.parentId === selection.id);
    if (selection.relationSource === "auto") {
      selection.behavior = hasChild ? "background" : "extract";
    }
    if (selection.parentId && !byId.has(selection.parentId)) selection.parentId = null;
  }
  return selections;
}

export function setSelectionIndependent(
  input: readonly CutoutSelection[],
  selectionId: string
): CutoutSelection[] {
  const selections = cloneCutoutSelections(input);
  const selection = selections.find((candidate) => candidate.id === selectionId);
  if (!selection) return selections;
  selection.behavior = "extract";
  selection.parentId = null;
  selection.relationSource = "manual";
  for (const child of selections) {
    if (child.parentId === selectionId && child.relationSource === "auto") {
      child.parentId = null;
      child.relationSource = "manual";
    }
  }
  for (const candidate of selections) {
    if (candidate.relationSource === "auto") {
      candidate.behavior = selections.some((child) => child.parentId === candidate.id)
        ? "background"
        : "extract";
    }
  }
  return selections;
}

export function setSelectionBackground(
  input: readonly CutoutSelection[],
  selectionId: string
): CutoutSelection[] {
  const selections = cloneCutoutSelections(input);
  const selection = selections.find((candidate) => candidate.id === selectionId);
  if (!selection) return selections;
  selection.behavior = "background";
  selection.relationSource = "manual";
  return selections;
}

export function translateCutoutSelection(
  input: readonly CutoutSelection[],
  selectionId: string,
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
  resolveNesting = true
): CutoutSelection[] {
  const selections = cloneCutoutSelections(input);
  const originalSelection = input.find((candidate) => candidate.id === selectionId);
  const selection = selections.find((candidate) => candidate.id === selectionId);
  if (!selection || !originalSelection) return selections;
  selection.x = clamp(Math.round(x), 0, Math.max(0, imageWidth - selection.width));
  selection.y = clamp(Math.round(y), 0, Math.max(0, imageHeight - selection.height));
  if (selection.polygon?.length) {
    const deltaX = selection.x - originalSelection.x;
    const deltaY = selection.y - originalSelection.y;
    selection.polygon = selection.polygon.map((point) => ({
      x: point.x + deltaX,
      y: point.y + deltaY
    }));
  }
  return resolveNesting ? applyAutomaticNesting(selections) : selections;
}

export function selectionChildren(
  selections: readonly CutoutSelection[],
  parentId: string
) {
  return selections.filter((selection) => selection.parentId === parentId);
}

/**
 * 自动分层中元素关系会经过 Alpha 包含度复核，文字框则只能沿用几何嵌套。
 * 合并两类结果后重新收敛父层用途，并清理损坏或成环的历史关系。
 */
export function resolveAutoLayerHierarchy(
  input: readonly CutoutSelection[],
  validatedElements: readonly CutoutSelection[]
) {
  const validatedById = new Map(validatedElements.map(selection => [selection.id, selection]));
  const selections = cloneCutoutSelections(input).map(selection => {
    if (selection.layerKind === "text") return selection;
    return validatedById.has(selection.id)
      ? normalizeCutoutSelection(validatedById.get(selection.id)!)
      : selection;
  });
  const byId = new Map(selections.map(selection => [selection.id, selection]));

  for (const selection of selections) {
    if (!selection.parentId) continue;
    const visited = new Set([selection.id]);
    let parentId: string | null = selection.parentId;
    let valid = true;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent || parent.layerKind === "text" || visited.has(parent.id)) {
        valid = false;
        break;
      }
      visited.add(parent.id);
      parentId = parent.parentId;
    }
    if (!valid) {
      selection.parentId = null;
      selection.behavior = "extract";
      selection.relationSource = "manual";
    }
  }

  for (const selection of selections) {
    if (selection.relationSource !== "auto") continue;
    selection.behavior = selections.some(child => child.parentId === selection.id)
      ? "background"
      : "extract";
  }
  return selections;
}

export function selectionDescendants(
  selections: readonly CutoutSelection[],
  parentId: string
) {
  const descendants: CutoutSelection[] = [];
  const pending = [parentId];
  const visited = new Set(pending);
  while (pending.length) {
    const currentParentId = pending.shift()!;
    for (const selection of selections) {
      if (selection.parentId !== currentParentId || visited.has(selection.id)) continue;
      visited.add(selection.id);
      descendants.push(selection);
      pending.push(selection.id);
    }
  }
  return descendants;
}
