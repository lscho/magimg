import { describe, expect, it } from "vitest";
import { compositeMaskedRgba } from "@/services/cutoutRepairCompositing";
import { buildCutoutRepairLayout } from "@/services/cutoutRepairLayout";
import {
  analyzeMaterialContext,
  alphaContentBounds,
  diffuseRepairRgba,
  fillRgbaOutsideAlpha,
  shouldForceManualDiffusion
} from "@/services/cutoutRepairContext";

describe("background repair compositing", () => {
  it("forces script-equivalent diffusion only for manual add strokes without children", () => {
    const selection = {
      id: "button",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      behavior: "background" as const,
      parentId: null,
      relationSource: "manual" as const,
      removalStrokes: [{
        id: "stroke",
        operation: "add" as const,
        radius: 12,
        smart: false,
        points: [{ x: 50, y: 50 }]
      }]
    };

    expect(shouldForceManualDiffusion(selection, false)).toBe(true);
    expect(shouldForceManualDiffusion(selection, true)).toBe(false);
    expect(shouldForceManualDiffusion({
      ...selection,
      removalStrokes: [{ ...selection.removalStrokes[0], smart: true }]
    }, false)).toBe(false);
    expect(shouldForceManualDiffusion({
      ...selection,
      removalStrokes: [{ ...selection.removalStrokes[0], operation: "restore" as const }]
    }, false)).toBe(false);
  });

  it("keeps unmasked RGBA exact and preserves source alpha inside the mask", () => {
    const source = new Uint8ClampedArray([
      10, 20, 30, 40,
      50, 60, 70, 80,
      90, 100, 110, 120
    ]);
    const repaired = new Uint8ClampedArray([
      200, 200, 200, 255,
      210, 220, 230, 255,
      240, 240, 240, 255
    ]);
    const output = compositeMaskedRgba(source, repaired, new Uint8Array([0, 255, 128]));
    expect([...output.slice(0, 4)]).toEqual([10, 20, 30, 40]);
    expect([...output.slice(4, 8)]).toEqual([210, 220, 230, 80]);
    expect([...output.slice(8, 12)]).toEqual([165, 170, 175, 120]);
  });

  it("uses only the active selection as local model context", () => {
    const layout = buildCutoutRepairLayout(
      { id: "avatar", x: 120, y: 80, width: 96, height: 128 },
      1920,
      1080,
      512,
      512
    );
    expect(layout.bounds).toEqual({ x: 120, y: 80, width: 96, height: 128 });
    expect(layout.inputRect).toEqual({ x: 64, y: 0, width: 384, height: 512 });
  });

  it("preserves wide selection geometry instead of stretching it to a square", () => {
    const layout = buildCutoutRepairLayout(
      { id: "button", x: 12, y: 20, width: 240, height: 80 },
      800,
      600,
      512,
      512
    );
    expect(layout.bounds).toEqual({ x: 12, y: 20, width: 240, height: 80 });
    expect(layout.inputRect).toEqual({ x: 0, y: 170, width: 512, height: 171 });
    expect(layout.inputRect.width / layout.inputRect.height).toBeCloseTo(3, 1);
  });

  it("tightens model context to the refined parent alpha", () => {
    const alpha = new Uint8Array(8 * 6);
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 3; x <= 6; x += 1) alpha[y * 8 + x] = 255;
    }
    alpha[0] = 4;
    expect(alphaContentBounds(
      alpha,
      8,
      6,
      { id: "button", x: 1, y: 1, width: 7, height: 5 }
    )).toEqual({ x: 3, y: 2, width: 4, height: 3 });
  });

  it("replaces pixels outside parent alpha with the detected material color", () => {
    const rgba = new Uint8ClampedArray([
      10, 20, 30, 255, 100, 110, 120, 255, 20, 30, 40, 255,
      11, 21, 31, 255, 21, 31, 41, 255, 31, 41, 51, 255
    ]);
    const filled = fillRgbaOutsideAlpha(
      rgba,
      new Uint8Array([0, 255, 0, 0, 0, 0]),
      3,
      2,
      [8, 9, 10]
    );
    expect([...filled.slice(0, 12)]).toEqual([
      8, 9, 10, 255,
      100, 110, 120, 255,
      8, 9, 10, 255
    ]);
    expect([...filled.slice(12)]).toEqual([
      8, 9, 10, 255,
      8, 9, 10, 255,
      8, 9, 10, 255
    ]);
  });

  it("detects a flat UI material and its dominant background color", () => {
    const width = 6;
    const height = 4;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const alpha = new Uint8Array(width * height).fill(255);
    const mask = new Uint8Array(width * height);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      rgba[offset] = 202 + (pixel % 2);
      rgba[offset + 1] = 224 + (pixel % 3);
      rgba[offset + 2] = 238;
      rgba[offset + 3] = 255;
    }
    mask[8] = 255;
    mask[9] = 255;

    const analysis = analyzeMaterialContext(rgba, alpha, mask, width, height);

    expect(analysis.fillColor[0]).toBeGreaterThanOrEqual(202);
    expect(analysis.fillColor[0]).toBeLessThanOrEqual(203);
    expect(analysis.fillColor[1]).toBeGreaterThanOrEqual(224);
    expect(analysis.fillColor[1]).toBeLessThanOrEqual(226);
    expect(analysis.fillColor[2]).toBe(238);
    expect(analysis.nearbyCoverage).toBe(1);
    expect(analysis.useDiffusion).toBe(true);
  });

  it("keeps varied texture on the LaMa path", () => {
    const width = 8;
    const height = 8;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const alpha = new Uint8Array(width * height).fill(255);
    const mask = new Uint8Array(width * height);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      rgba[offset] = (pixel * 47) % 256;
      rgba[offset + 1] = (pixel * 83) % 256;
      rgba[offset + 2] = (pixel * 131) % 256;
      rgba[offset + 3] = 255;
    }

    const analysis = analyzeMaterialContext(rgba, alpha, mask, width, height);

    expect(analysis.nearbyCoverage).toBeLessThan(0.4);
    expect(analysis.useDiffusion).toBe(false);
  });

  it("prefers known colors next to the repair area over distant material", () => {
    const width = 20;
    const height = 7;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const alpha = new Uint8Array(width * height).fill(255);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const localBackground = x >= 11;
        rgba[offset] = localBackground ? 75 : 220;
        rgba[offset + 1] = localBackground ? 155 : 90;
        rgba[offset + 2] = localBackground ? 215 : 80;
        rgba[offset + 3] = 255;
      }
    }
    mask[3 * width + 15] = 255;

    const analysis = analyzeMaterialContext(rgba, alpha, mask, width, height);

    expect(analysis.fillColor).toEqual([75, 155, 215]);
    expect(analysis.useDiffusion).toBe(true);
  });

  it("diffuses surrounding UI colors only into the repair mask", () => {
    const width = 5;
    const height = 5;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const alpha = new Uint8Array(width * height).fill(255);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        rgba[offset] = 80 + x * 4;
        rgba[offset + 1] = 120 + y * 4;
        rgba[offset + 2] = 160;
        rgba[offset + 3] = 200;
        if (x >= 1 && x <= 3 && y >= 1 && y <= 3) {
          rgba[offset] = 250;
          rgba[offset + 1] = 20;
          rgba[offset + 2] = 40;
          mask[pixel] = 255;
        }
      }
    }
    const original = rgba.slice();
    const repaired = diffuseRepairRgba(
      rgba,
      alpha,
      mask,
      width,
      height,
      [88, 128, 160]
    );

    expect([...repaired.slice(0, 4)]).toEqual([...original.slice(0, 4)]);
    expect([...repaired.slice(24 * 4, 25 * 4)]).toEqual([...original.slice(24 * 4, 25 * 4)]);
    const center = (2 * width + 2) * 4;
    expect(repaired[center]).toBeGreaterThanOrEqual(84);
    expect(repaired[center]).toBeLessThanOrEqual(92);
    expect(repaired[center + 1]).toBeGreaterThanOrEqual(124);
    expect(repaired[center + 1]).toBeLessThanOrEqual(132);
    expect(repaired[center + 2]).toBe(160);
    expect(repaired[center + 3]).toBe(200);
  });

  it("does not pull decorative border colors into a flat repair area", () => {
    const width = 7;
    const height = 7;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const alpha = new Uint8Array(width * height).fill(255);
    const mask = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const offset = pixel * 4;
        const decorativeBorder = y === 0;
        rgba[offset] = decorativeBorder ? 40 : 238;
        rgba[offset + 1] = decorativeBorder ? 150 : 228;
        rgba[offset + 2] = decorativeBorder ? 170 : 201;
        rgba[offset + 3] = 255;
        if (x >= 1 && x <= 5 && y >= 1 && y <= 5) mask[pixel] = 255;
      }
    }

    const repaired = diffuseRepairRgba(
      rgba,
      alpha,
      mask,
      width,
      height,
      [238, 228, 201]
    );
    const repairedTop = (1 * width + 3) * 4;

    expect([...repaired.slice(repairedTop, repairedTop + 3)]).toEqual([238, 228, 201]);
  });
});
