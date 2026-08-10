import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
  applyOpaquePanelPrior,
  constrainAlphaToPanelOuter,
  detectCompoundPanelInterior
} from "@/services/cutoutCompoundPanel";

function roundedRectangleContains(
  x: number,
  y: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  radius: number
) {
  const closestX = Math.min(right - radius, Math.max(left + radius, x));
  const closestY = Math.min(bottom - radius, Math.max(top + radius, y));
  return (x - closestX) ** 2 + (y - closestY) ** 2 <= radius ** 2;
}

function panelPixels(width = 100, height = 110) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba[pixel * 4] = 24;
    rgba[pixel * 4 + 1] = 42;
    rgba[pixel * 4 + 2] = 58;
    rgba[pixel * 4 + 3] = 255;
  }
  for (let y = 12; y < 104; y += 1) {
    for (let x = 7; x < 94; x += 1) {
      if (!roundedRectangleContains(x, y, 7, 12, 94, 104, 11)) continue;
      const border = !roundedRectangleContains(x, y, 11, 16, 90, 100, 8);
      const offset = (y * width + x) * 4;
      const value = border ? 238 : 188;
      rgba[offset] = value;
      rgba[offset + 1] = border ? 190 : 178;
      rgba[offset + 2] = border ? 80 : 156;
    }
  }
  return rgba;
}

const regressionImage = PNG.sync.read(
  readFileSync(new URL("../../tests/test.png", import.meta.url))
);

function regressionCrop(x: number, y: number, width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * regressionImage.width + x) * 4;
    rgba.set(
      regressionImage.data.subarray(sourceStart, sourceStart + width * 4),
      row * width * 4
    );
  }
  return rgba;
}

describe("compound UI panel recovery", () => {
  it("detects a tightly selected rounded panel and fills only its inset interior", () => {
    const detection = detectCompoundPanelInterior(panelPixels(), 100, 110);

    expect(detection).not.toBeNull();
    expect(detection?.bounds.width).toBeGreaterThan(80);
    expect(detection?.bounds.height).toBeGreaterThan(85);
    expect(detection?.alpha[55 * 100 + 50]).toBe(255);
    expect(detection?.alpha[0]).toBe(0);
    expect(detection?.alpha[13 * 100 + 8]).toBe(0);
    expect(detection?.outerAlpha[55 * 100 + 50]).toBe(255);
    expect(detection?.outerAlpha[0]).toBe(0);
  });

  it("keeps protruding subject soft alpha while making the panel interior opaque", () => {
    const prior = detectCompoundPanelInterior(panelPixels(), 100, 110)?.alpha ?? null;
    const subject = new Uint8Array(100 * 110);
    subject[4 * 100 + 50] = 96;
    subject[20 * 100 + 50] = 220;

    const merged = applyOpaquePanelPrior(subject, prior);

    expect(merged[4 * 100 + 50]).toBe(96);
    expect(merged[55 * 100 + 50]).toBe(255);
  });

  it("does not turn an ordinary isolated subject into a rectangular foreground", () => {
    const width = 100;
    const height = 110;
    const rgba = new Uint8ClampedArray(width * height * 4).fill(32);
    for (let pixel = 0; pixel < width * height; pixel += 1) rgba[pixel * 4 + 3] = 255;
    for (let y = 30; y < 82; y += 1) {
      for (let x = 34; x < 67; x += 1) {
        const offset = (y * width + x) * 4;
        rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 210;
      }
    }

    expect(detectCompoundPanelInterior(rgba, width, height)).toBeNull();
  });

  it("rejects mismatched alpha planes", () => {
    expect(() => applyOpaquePanelPrior(new Uint8Array(4), new Uint8Array(5))).toThrow(
      "面板先验尺寸与抠图 Alpha 不匹配"
    );
    expect(() => constrainAlphaToPanelOuter(new Uint8Array(4), new Uint8Array(5))).toThrow(
      "面板外轮廓尺寸与抠图 Alpha 不匹配"
    );
  });

  it("removes automatic-layer background noise outside a detected panel", () => {
    const outer = detectCompoundPanelInterior(panelPixels(), 100, 110)?.outerAlpha ?? null;
    const alpha = new Uint8Array(100 * 110).fill(255);
    const constrained = constrainAlphaToPanelOuter(alpha, outer);

    expect(constrained[0]).toBe(0);
    expect(constrained[55 * 100 + 50]).toBe(255);
  });

  it("recovers the real panel when the portrait protrudes beyond its top edge", () => {
    const detection = detectCompoundPanelInterior(
      regressionCrop(305, 2430, 205, 243),
      205,
      243
    );

    expect(detection?.bounds).toEqual({ x: 10, y: 23, width: 183, height: 209 });
  });

  it("ignores an unrelated full-width rule above a protruding portrait panel", () => {
    const detection = detectCompoundPanelInterior(
      regressionCrop(305, 2415, 205, 258),
      205,
      258
    );

    expect(detection?.bounds).toEqual({ x: 10, y: 38, width: 183, height: 209 });
    expect(detection?.alpha[20 * 205 + 100]).toBe(0);
    expect(detection?.alpha[140 * 205 + 100]).toBe(255);
  });

  it("recovers the real portrait panel when the portrait stays inside", () => {
    const detection = detectCompoundPanelInterior(
      regressionCrop(66, 80, 255, 261),
      255,
      261
    );

    expect(detection?.bounds).toEqual({ x: 8, y: 9, width: 238, height: 240 });
  });

  it("fits the real portrait panel corners instead of filling their background", () => {
    const detection = detectCompoundPanelInterior(
      regressionCrop(65, 79, 260, 265),
      260,
      265
    );

    expect(detection?.bounds).toEqual({ x: 9, y: 10, width: 238, height: 240 });
    expect(detection?.cornerRadii).toEqual({
      topLeft: 39,
      topRight: 40,
      bottomLeft: 37,
      bottomRight: 38
    });
    expect(detection?.alpha[20 * 260 + 19]).toBe(0);
    expect(detection?.alpha[132 * 260 + 130]).toBe(255);
  });

  it("fits the deeper rounded corners on the real activity panel", () => {
    const detection = detectCompoundPanelInterior(
      regressionCrop(469, 400, 253, 263),
      253,
      263
    );

    expect(detection?.bounds).toEqual({ x: 20, y: 17, width: 198, height: 211 });
    expect(detection?.cornerRadii).toEqual({
      topLeft: 47,
      topRight: 49,
      bottomLeft: 46,
      bottomRight: 45
    });
    expect(detection?.alpha[24 * 253 + 30]).toBe(0);
    expect(detection?.alpha[130 * 253 + 126]).toBe(255);
  });

  it("does not recover a panel around the real standalone subject", () => {
    expect(detectCompoundPanelInterior(
      regressionCrop(654, 1726, 226, 420),
      226,
      420
    )).toBeNull();
  });
});
