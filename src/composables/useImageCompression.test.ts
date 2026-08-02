import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPRESSION_SETTINGS,
  applyCompressionProgress,
  compressionWorkspaceItem
} from "@/composables/useImageCompression";
import type { CompressionProgressEvent, CompressionSourceItem } from "@/types";

const source: CompressionSourceItem = {
  id: "item-1",
  relativePath: "nested/photo.webp",
  format: "webp",
  width: 1200,
  height: 800,
  size: 1000
};

describe("image compression progress", () => {
  it("uses the approved defaults", () => {
    expect(DEFAULT_COMPRESSION_SETTINGS).toEqual({
      pngLevel: "balanced",
      jpegQuality: 82,
      jpegProgressive: true,
      webpMode: "lossy",
      webpQuality: 82,
      conflictPolicy: "rename",
      skipNoBenefit: true
    });
  });

  it("merges item progress without mutating the previous row", () => {
    const pending = compressionWorkspaceItem(source);
    const started = applyCompressionProgress([pending], {
      type: "itemStarted",
      itemId: source.id,
      index: 0,
      total: 1,
      relativePath: source.relativePath
    });
    expect(pending.status).toBe("pending");
    expect(started[0].status).toBe("processing");

    const finished: CompressionProgressEvent = {
      type: "itemFinished",
      itemId: source.id,
      index: 0,
      status: "succeeded",
      outputRelativePath: "nested/photo (1).webp",
      outputSize: 650,
      savedPercent: 35,
      message: null
    };
    expect(applyCompressionProgress(started, finished)[0]).toMatchObject({
      status: "succeeded",
      outputRelativePath: "nested/photo (1).webp",
      outputSize: 650,
      savedPercent: 35
    });
  });

  it("marks pending rows cancelled after a cancelled summary", () => {
    const result = applyCompressionProgress([compressionWorkspaceItem(source)], {
      type: "finished",
      summary: {
        total: 1,
        succeeded: 0,
        noBenefit: 0,
        skipped: 0,
        failed: 0,
        cancelled: 1,
        originalBytes: 0,
        outputBytes: 0,
        savedBytes: 0,
        wasCancelled: true
      }
    });
    expect(result[0].status).toBe("cancelled");
  });
});
