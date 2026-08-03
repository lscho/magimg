import { describe, expect, it } from "vitest";
import {
  isAbsoluteLocalImagePath,
  normalizeAutoLayerSelectionRecord
} from "@/services/autoLayerSelectionHistoryModel";

const validRecord = {
  schemaVersion: 1,
  id: "auto-layer-selection-1-test",
  sourcePath: "/Users/example/source.png",
  sourceName: "source.png",
  sourceMimeType: "image/png",
  sourceWidth: 1200,
  sourceHeight: 800,
  thumbnailUrl: "data:image/webp;base64,AAAA",
  selections: [{ id: "one", x: 10, y: 20, width: 100, height: 80, layerKind: "text" }],
  createdAt: "2026-08-03T00:00:00.000Z"
};

describe("automatic-layer selection history model", () => {
  it("accepts macOS, Windows and UNC absolute paths", () => {
    expect(isAbsoluteLocalImagePath("/Users/example/source.png")).toBe(true);
    expect(isAbsoluteLocalImagePath("C:\\images\\source.png")).toBe(true);
    expect(isAbsoluteLocalImagePath("\\\\server\\images\\source.png")).toBe(true);
    expect(isAbsoluteLocalImagePath("source.png")).toBe(false);
  });

  it("normalizes saved selections with automatic-layer kinds", () => {
    const record = normalizeAutoLayerSelectionRecord(validRecord);

    expect(record?.selections[0]).toMatchObject({
      id: "one",
      layerKind: "text",
      behavior: "extract",
      parentId: null
    });
  });

  it("rejects records without a recoverable source path", () => {
    expect(normalizeAutoLayerSelectionRecord({ ...validRecord, sourcePath: "source.png" })).toBeNull();
  });
});
