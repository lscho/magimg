import { describe, expect, it } from "vitest";
import {
  isStoredCutoutHistoryRecord,
  normalizeCutoutHistoryRecord
} from "@/services/cutoutHistoryModel";
import { applyAutomaticNesting } from "@/services/cutoutSelectionModel";

describe("cutout history migration", () => {
  it("upgrades legacy rectangle-only records to schema v2 foreground assets", () => {
    const legacy = {
      id: "cutout-123-abc",
      mattingId: "matting-1",
      source: {
        originalName: "avatar.png",
        storedFileName: "source.png",
        mimeType: "image/png",
        width: 100,
        height: 100,
        cloudInputAssetId: "40"
      },
      selections: [
        { id: "selection-1", x: 0, y: 0, width: 80, height: 80 },
        { id: "selection-2", x: 10, y: 10, width: 30, height: 40 }
      ],
      assets: [{
        id: "asset-1",
        storedFileName: "result-1.png",
        baseName: "avatar-cutout-1",
        width: 30,
        height: 40,
        thumbnailUrl: "data:image/png;base64,AA==",
        sourceBox: { id: "selection-1", x: 1, y: 2, width: 30, height: 40 }
      }],
      costCredits: 5,
      createdAt: "2026-07-28T00:00:00.000Z"
    };
    expect(isStoredCutoutHistoryRecord(legacy)).toBe(true);
    const migrated = normalizeCutoutHistoryRecord(legacy);
    expect(migrated?.schemaVersion).toBe(2);
    expect(migrated?.selections[0]).toMatchObject({
      behavior: "extract",
      parentId: null,
      relationSource: "manual",
      removalStrokes: []
    });
    expect(migrated?.selections[1]).toMatchObject({
      behavior: "extract",
      parentId: null,
      relationSource: "manual",
      removalStrokes: []
    });
    expect(applyAutomaticNesting(migrated?.selections ?? []).every(
      (selection) => selection.behavior === "extract" && selection.parentId === null
    )).toBe(true);
    expect(migrated?.assets[0]).toMatchObject({
      kind: "foreground",
      sourceSelectionId: "selection-1"
    });
    expect(migrated?.source.cloudInputAssetId).toBe("40");
  });
});
