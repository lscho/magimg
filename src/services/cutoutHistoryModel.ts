import { normalizeCutoutSelection } from "@/services/cutoutSelectionModel";
import type {
  CutoutHistoryAsset,
  CutoutHistoryRecord,
  CutoutSelection
} from "@/types";

const TASK_ID_PATTERN = /^cutout-[a-zA-Z0-9-]+$/u;

export function isStoredCutoutHistoryRecord(
  value: unknown
): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" &&
    TASK_ID_PATTERN.test(record.id) &&
    typeof record.mattingId === "string" &&
    typeof record.createdAt === "string" &&
    Number.isInteger(record.costCredits) &&
    Boolean(record.source) &&
    Array.isArray(record.selections) &&
    Array.isArray(record.assets);
}

function normalizeHistoryAsset(value: unknown, index: number): CutoutHistoryAsset | null {
  if (!value || typeof value !== "object") return null;
  const asset = value as Partial<CutoutHistoryAsset>;
  if (
    typeof asset.id !== "string" ||
    typeof asset.storedFileName !== "string" ||
    typeof asset.baseName !== "string" ||
    !Number.isFinite(asset.width) ||
    !Number.isFinite(asset.height) ||
    typeof asset.thumbnailUrl !== "string" ||
    !asset.sourceBox
  ) return null;
  const sourceBox = normalizeCutoutSelection(asset.sourceBox);
  return {
    id: asset.id,
    storedFileName: asset.storedFileName,
    baseName: asset.baseName,
    width: Number(asset.width),
    height: Number(asset.height),
    thumbnailUrl: asset.thumbnailUrl,
    sourceBox: {
      id: sourceBox.id,
      x: sourceBox.x,
      y: sourceBox.y,
      width: sourceBox.width,
      height: sourceBox.height
    },
    sourceSelectionId: typeof asset.sourceSelectionId === "string"
      ? asset.sourceSelectionId
      : sourceBox.id || `legacy-selection-${index + 1}`,
    kind: asset.kind === "background" ? "background" : "foreground",
    ...(asset.repairMode === "local" || asset.repairMode === "cloud"
      ? { repairMode: asset.repairMode }
      : {})
  };
}

export function normalizeCutoutHistoryRecord(
  value: Record<string, unknown>
): CutoutHistoryRecord | null {
  const source = value.source as CutoutHistoryRecord["source"] | undefined;
  if (!source || typeof source.originalName !== "string" ||
    typeof source.storedFileName !== "string" ||
    !["image/png", "image/jpeg", "image/webp"].includes(source.mimeType) ||
    !Number.isFinite(source.width) || !Number.isFinite(source.height)) return null;
  const isSchemaV2 = value.schemaVersion === 2;
  const selections = (value.selections as unknown[]).map((selection) => {
    const normalized = normalizeCutoutSelection(selection as Partial<CutoutSelection>);
    return isSchemaV2
      ? normalized
      : {
        ...normalized,
        behavior: "extract" as const,
        parentId: null,
        relationSource: "manual" as const,
        removalStrokes: []
      };
  });
  const assets = (value.assets as unknown[])
    .map(normalizeHistoryAsset)
    .filter((asset): asset is CutoutHistoryAsset => Boolean(asset));
  return {
    schemaVersion: 2,
    id: String(value.id),
    mattingId: String(value.mattingId),
    source: {
      originalName: source.originalName,
      storedFileName: source.storedFileName,
      mimeType: source.mimeType,
      width: Number(source.width),
      height: Number(source.height),
      ...(typeof source.cloudInputAssetId === "string" && /^[1-9]\d*$/u.test(source.cloudInputAssetId)
        ? { cloudInputAssetId: source.cloudInputAssetId }
        : {})
    },
    selections,
    assets,
    costCredits: Number(value.costCredits),
    createdAt: String(value.createdAt)
  };
}
