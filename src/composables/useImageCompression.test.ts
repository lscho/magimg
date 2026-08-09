import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPRESSION_SETTINGS,
  applyCompressionProgress,
  applyCompressionSave,
  compressionSaveToastMessage,
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

  it("applies cancellation reported for the active item", () => {
    const processing = {
      ...compressionWorkspaceItem(source),
      status: "processing" as const
    };
    const result = applyCompressionProgress([processing], {
      type: "itemFinished",
      itemId: source.id,
      index: 0,
      status: "cancelled",
      outputRelativePath: null,
      outputSize: null,
      savedPercent: null,
      message: "压缩已取消。"
    });

    expect(result[0]).toMatchObject({ status: "cancelled", message: "压缩已取消。" });
  });

  it("applies save results to the matching compressed row", () => {
    const compressed = {
      ...compressionWorkspaceItem(source),
      status: "succeeded" as const,
      outputRelativePath: source.relativePath,
      outputSize: 650,
      savedPercent: 35
    };
    const result = applyCompressionSave([compressed], {
      saved: 1,
      skipped: 0,
      failed: 0,
      items: [{
        itemId: source.id,
        status: "saved",
        outputRelativePath: "nested/photo (1).webp",
        message: null
      }]
    });

    expect(result[0]).toMatchObject({
      saveStatus: "saved",
      outputRelativePath: "nested/photo (1).webp",
      saveMessage: ""
    });
    expect(compressed.outputRelativePath).toBe(source.relativePath);
  });

  it("builds a temporary success toast message from the save result", () => {
    expect(compressionSaveToastMessage({
      saved: 2,
      skipped: 1,
      failed: 0,
      items: []
    })).toBe("已保存 2 个压缩结果，跳过 1 个");

    expect(compressionSaveToastMessage({
      saved: 0,
      skipped: 1,
      failed: 0,
      items: []
    })).toBe("");
  });
});
