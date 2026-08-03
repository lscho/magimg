import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  loadSource: vi.fn(),
  read: vi.fn(),
  write: vi.fn()
}));

vi.mock("@/services/desktop", () => ({
  autoLayerSelectionSourceExists: mocks.exists,
  isDesktopApp: () => true,
  loadAutoLayerSelectionSource: mocks.loadSource
}));

vi.mock("@/services/localStorage", () => ({
  readJsonValue: mocks.read,
  writeJsonValue: mocks.write
}));

import { readAutoLayerSelectionRecords } from "@/services/autoLayerSelectionHistory";

function record(id: string, sourcePath: string) {
  return {
    schemaVersion: 1,
    id: `auto-layer-selection-${id}`,
    sourcePath,
    sourceName: `${id}.png`,
    sourceMimeType: "image/png",
    sourceWidth: 100,
    sourceHeight: 80,
    thumbnailUrl: "data:image/webp;base64,AAAA",
    selections: [{ id: `${id}-box`, x: 1, y: 2, width: 20, height: 10 }],
    createdAt: "2026-08-03T00:00:00.000Z"
  };
}

describe("automatic-layer selection history storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes records whose original image path no longer exists", async () => {
    const available = record("available", "/images/available.png");
    const missing = record("missing", "/images/missing.png");
    mocks.read.mockResolvedValue([available, missing]);
    mocks.exists.mockImplementation(async (path: string) => path === available.sourcePath);

    const result = await readAutoLayerSelectionRecords();

    expect(result.records.map(item => item.id)).toEqual([available.id]);
    expect(result.removedCount).toBe(1);
    expect(mocks.write).toHaveBeenCalledWith(
      "auto-layer-selections.json",
      "items",
      [expect.objectContaining({ id: available.id })]
    );
  });
});
