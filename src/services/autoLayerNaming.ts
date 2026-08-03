import type { CutoutSelectionBox } from "@/types";

export const AUTO_LAYER_TYPES = [
  "card", "btn", "icon", "avatar", "image", "nav", "tab", "panel",
  "badge", "character", "decoration", "element"
] as const;

export interface AutoLayerNameCandidate {
  id: string;
  kind: "material" | "text";
  box: CutoutSelectionBox;
  type: string;
  confidence: number;
  cleanedChildren?: boolean;
}

function positionPrefix(box: CutoutSelectionBox, width: number, height: number) {
  const x = (box.x + box.width / 2) / Math.max(1, width);
  const y = (box.y + box.height / 2) / Math.max(1, height);
  if (y < 0.34) return "top";
  if (y > 0.66) return "bottom";
  if (x < 0.34) return "left";
  if (x > 0.66) return "right";
  return "center";
}

export function assignAutoLayerNames(
  candidates: readonly AutoLayerNameCandidate[],
  width: number,
  height: number
): Map<string, string> {
  const roles = candidates.map((candidate) => candidate.kind === "text"
    ? "text"
    : candidate.confidence >= 0.45 && AUTO_LAYER_TYPES.includes(candidate.type as typeof AUTO_LAYER_TYPES[number])
      ? candidate.type
      : "element"
  );
  const counts = new Map<string, number>();
  roles.forEach((role) => counts.set(role, (counts.get(role) ?? 0) + 1));
  const used = new Map<string, number>();
  const result = new Map<string, string>();
  candidates.forEach((candidate, index) => {
    const role = roles[index];
    const needsPosition = (counts.get(role) ?? 0) > 1 || candidate.confidence < 0.45 || candidate.kind === "text";
    const base = `${needsPosition ? `${positionPrefix(candidate.box, width, height)}-` : ""}${role}${candidate.cleanedChildren ? "-bg" : ""}`;
    const collision = (used.get(base) ?? 0) + 1;
    used.set(base, collision);
    result.set(candidate.id, collision === 1 ? base : `${base}-${collision}`);
  });
  return result;
}
