import { cloneCutoutSelections } from "@/services/cutoutSelectionModel";
import type { AutoLayerSelectionRecord, CutoutSelection } from "@/types";

const RECORD_ID_PATTERN = /^auto-layer-selection-[a-zA-Z0-9-]+$/u;
const THUMBNAIL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,/u;

export function isAbsoluteLocalImagePath(path: string) {
  return path.startsWith("/") || /^[a-zA-Z]:[\\/]/u.test(path) || path.startsWith("\\\\");
}

function validSelection(value: unknown): value is Partial<CutoutSelection> {
  if (!value || typeof value !== "object") return false;
  const selection = value as Partial<CutoutSelection>;
  return typeof selection.id === "string" && selection.id.length > 0 &&
    Number.isFinite(selection.x) && Number.isFinite(selection.y) &&
    Number.isFinite(selection.width) && Number.isFinite(selection.height) &&
    Number(selection.width) > 0 && Number(selection.height) > 0;
}

export function normalizeAutoLayerSelectionRecord(value: unknown): AutoLayerSelectionRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<AutoLayerSelectionRecord>;
  if (
    record.schemaVersion !== 1 ||
    typeof record.id !== "string" || !RECORD_ID_PATTERN.test(record.id) ||
    typeof record.sourcePath !== "string" || !isAbsoluteLocalImagePath(record.sourcePath) ||
    typeof record.sourceName !== "string" || !record.sourceName.trim() ||
    !["image/png", "image/jpeg", "image/webp"].includes(record.sourceMimeType ?? "") ||
    !Number.isFinite(record.sourceWidth) || Number(record.sourceWidth) <= 0 ||
    !Number.isFinite(record.sourceHeight) || Number(record.sourceHeight) <= 0 ||
    typeof record.thumbnailUrl !== "string" || !THUMBNAIL_PATTERN.test(record.thumbnailUrl) ||
    !Array.isArray(record.selections) || !record.selections.length ||
    !record.selections.every(validSelection) ||
    typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))
  ) return null;

  return {
    schemaVersion: 1,
    id: record.id,
    sourcePath: record.sourcePath,
    sourceName: record.sourceName,
    sourceMimeType: record.sourceMimeType as AutoLayerSelectionRecord["sourceMimeType"],
    sourceWidth: Math.round(Number(record.sourceWidth)),
    sourceHeight: Math.round(Number(record.sourceHeight)),
    thumbnailUrl: record.thumbnailUrl,
    selections: cloneCutoutSelections(record.selections),
    createdAt: record.createdAt
  };
}
