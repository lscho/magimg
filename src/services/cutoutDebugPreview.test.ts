import { describe, expect, it } from "vitest";
import {
  DEBUG_MASK_THRESHOLD,
  formatDuration,
  formatPercent,
  maskDiff,
  maskStats,
  previewSize,
  samplePlane
} from "@/services/cutoutDebugPreview";

describe("maskStats", () => {
  it("统计全零蒙版不计入覆盖", () => {
    const mask = new Uint8Array(100);
    const stats = maskStats(mask);
    expect(stats.area).toBe(0);
    expect(stats.coverage).toBe(0);
    expect(stats.softArea).toBe(0);
    expect(stats.maxValue).toBe(0);
  });

  it("统计全白蒙版为满覆盖", () => {
    const mask = new Uint8Array(100).fill(255);
    const stats = maskStats(mask);
    expect(stats.area).toBe(100);
    expect(stats.coverage).toBe(1);
    expect(stats.softArea).toBe(0);
    expect(stats.maxValue).toBe(255);
  });

  it("半透明像素计入 softArea，低于阈值不计入覆盖", () => {
    const mask = new Uint8Array([10, 100, 255, 0]);
    const stats = maskStats(mask);
    expect(stats.area).toBe(2); // 100 与 255 超过阈值
    expect(stats.softArea).toBe(2); // 10 与 100 均为半透明
    expect(stats.maxValue).toBe(255);
  });

  it("阈值与修复链路默认阈值一致", () => {
    expect(DEBUG_MASK_THRESHOLD).toBe(16);
  });
});

describe("maskDiff", () => {
  it("计算 IoU 与收缩/新增像素", () => {
    const before = new Uint8Array([255, 255, 0, 0]);
    const after = new Uint8Array([255, 0, 255, 0]);
    const diff = maskDiff(before, after);
    expect(diff.shared).toBe(1);
    expect(diff.onlyBefore).toBe(1);
    expect(diff.onlyAfter).toBe(1);
    expect(diff.iou).toBeCloseTo(1 / 3, 5);
  });

  it("完全相同的蒙版 IoU 为 1", () => {
    const mask = new Uint8Array([255, 0, 255, 0]);
    const diff = maskDiff(mask, mask);
    expect(diff.iou).toBe(1);
    expect(diff.onlyBefore).toBe(0);
    expect(diff.onlyAfter).toBe(0);
  });

  it("尺寸不一致时抛错", () => {
    expect(() => maskDiff(new Uint8Array(4), new Uint8Array(8))).toThrow();
  });
});

describe("previewSize / samplePlane", () => {
  it("不超过最长边时保持原尺寸", () => {
    const size = previewSize(400, 300, 560);
    expect(size.width).toBe(400);
    expect(size.height).toBe(300);
    expect(size.scale).toBe(1);
  });

  it("超过最长边时等比缩小", () => {
    const size = previewSize(1120, 560, 560);
    expect(size.width).toBe(560);
    expect(size.height).toBe(280);
    expect(size.scale).toBe(0.5);
  });

  it("最近邻下采样保留边缘像素", () => {
    const plane = new Uint8Array([255, 0, 0, 0]);
    const size = previewSize(2, 2, 560);
    const sampled = samplePlane(plane, 2, 2, size);
    expect(sampled.length).toBe(4);
    expect(sampled[0]).toBe(255);
    expect(sampled[3]).toBe(0);
  });

  it("平面尺寸与图片不匹配时抛错", () => {
    expect(() => samplePlane(new Uint8Array(4), 3, 3, previewSize(3, 3))).toThrow();
  });
});

describe("formatDuration / formatPercent", () => {
  it("毫秒与秒格式化", () => {
    expect(formatDuration(500)).toBe("500 ms");
    expect(formatDuration(1500)).toBe("1.50 s");
  });

  it("百分比格式化", () => {
    expect(formatPercent(0.1234)).toBe("12.34%");
    expect(formatPercent(1)).toBe("100.00%");
  });
});
