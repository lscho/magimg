import { describe, expect, it } from "vitest";
import {
  analyzeBackgroundExtraction,
  analyzeBackgroundTexture,
  shouldExtractBackgroundLocally,
  type AutoLayerBackgroundAnalysis
} from "@/services/autoLayerBackgroundExtraction";

function rgbaOf(size: number, pixel: (x: number, y: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x, y);
      const offset = (y * size + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = 255;
    }
  }
  return data;
}

function centeredMask(size: number, left: number, top: number, right: number, bottom: number) {
  const mask = new Uint8Array(size * size);
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      mask[y * size + x] = 255;
    }
  }
  return mask;
}

describe("automatic-layer background extraction", () => {
  it("extracts locally when the background around the mask is a solid color", () => {
    const size = 256;
    const rgba = rgbaOf(size, () => [128, 128, 128]);
    const mask = centeredMask(size, 96, 96, 160, 160);

    const analysis = analyzeBackgroundExtraction(rgba, mask, size, size);

    expect(analysis.useDiffusion).toBe(true);
    expect(analysis.fillColor).toEqual([128, 128, 128]);
  });

  it("extracts locally for a slow gradient background", () => {
    const size = 256;
    const rgba = rgbaOf(size, (x, y) => [100 + (x + y) / 8, 100 + (x + y) / 8, 100 + (x + y) / 8]);
    const mask = centeredMask(size, 96, 96, 160, 160);

    expect(analyzeBackgroundExtraction(rgba, mask, size, size).useDiffusion).toBe(true);
  });

  it("keeps the cloud path for a noisy photo-like background", () => {
    const size = 256;
    // 每 8×8 块一个随机色，蒙版邻域内颜色高度分散。
    const rgba = rgbaOf(size, (x, y) => {
      const seed = Math.floor(x / 8) * 37 + Math.floor(y / 8) * 91;
      return [(seed * 29) % 256, (seed * 53) % 256, (seed * 79) % 256];
    });
    const mask = centeredMask(size, 96, 96, 160, 160);

    expect(analyzeBackgroundExtraction(rgba, mask, size, size).useDiffusion).toBe(false);
  });

  it("keeps the cloud path when the mask spans several distinct color regions", () => {
    const size = 256;
    const rgba = rgbaOf(size, (x, y) => (
      x < size / 2
        ? (y < size / 2 ? [200, 40, 40] : [40, 200, 40])
        : (y < size / 2 ? [40, 40, 200] : [200, 200, 40])
    ));
    // 蒙版覆盖四个色块的中心，邻域颜色集中在 4 个簇，扩散不适用。
    const mask = centeredMask(size, 64, 64, 192, 192);

    expect(analyzeBackgroundExtraction(rgba, mask, size, size).useDiffusion).toBe(false);
  });

  it("keeps the cloud path when the mask covers the whole image and leaves no background", () => {
    const size = 256;
    const rgba = rgbaOf(size, () => [10, 10, 10]);
    // 蒙版占满整图：没有任何已知背景像素可参照，不能本地提取。
    const mask = centeredMask(size, 0, 0, size, size);

    expect(analyzeBackgroundExtraction(rgba, mask, size, size).useDiffusion).toBe(false);
  });

  it("marks smooth wide stripe backgrounds as low texture", () => {
    const size = 256;
    // 48px 宽的低对比竖条纹：梯度只出现在条纹边界，平均能量很低。
    const palette: Array<[number, number, number]> = [
      [240, 230, 225],
      [225, 240, 230],
      [230, 225, 240]
    ];
    const rgba = rgbaOf(size, (x) => palette[Math.floor(x / 48) % palette.length]);
    const mask = centeredMask(size, 96, 96, 160, 160);

    expect(analyzeBackgroundTexture(rgba, mask, size, size)).toBe(true);
  });

  it("marks noisy photo-like backgrounds as high texture", () => {
    const size = 256;
    const rgba = rgbaOf(size, (x, y) => {
      const seed = Math.floor(x / 8) * 37 + Math.floor(y / 8) * 91;
      return [(seed * 29) % 256, (seed * 53) % 256, (seed * 79) % 256];
    });
    const mask = centeredMask(size, 96, 96, 160, 160);

    expect(analyzeBackgroundTexture(rgba, mask, size, size)).toBe(false);
  });

  it("keeps multi-color block backgrounds on the cloud path even with low texture energy", () => {
    const size = 256;
    const rgba = rgbaOf(size, (x, y) => (
      x < size / 2
        ? (y < size / 2 ? [200, 40, 40] : [40, 200, 40])
        : (y < size / 2 ? [40, 40, 200] : [200, 200, 40])
    ));
    const mask = centeredMask(size, 64, 64, 192, 192);
    const analysis = analyzeBackgroundExtraction(rgba, mask, size, size);

    // 色块内部平坦但邻域颜色不集中，不能走本地扩散。
    expect(shouldExtractBackgroundLocally(analysis)).toBe(false);
  });
});

describe("automatic-layer local extraction decision", () => {
  function analysisOf(overrides: Partial<AutoLayerBackgroundAnalysis>): AutoLayerBackgroundAnalysis {
    return {
      fillColor: [128, 128, 128],
      dominantCoverage: 0.4,
      nearbyCoverage: 0.35,
      useDiffusion: false,
      lowTexture: false,
      ...overrides
    };
  }

  it("extracts locally when diffusion already applies", () => {
    expect(shouldExtractBackgroundLocally(analysisOf({ useDiffusion: true }))).toBe(true);
  });

  it("extracts locally for low-texture backgrounds with concentrated nearby colors", () => {
    expect(shouldExtractBackgroundLocally(analysisOf({ lowTexture: true, nearbyCoverage: 0.35 }))).toBe(true);
  });

  it("keeps the cloud path when nearby colors are scattered", () => {
    expect(shouldExtractBackgroundLocally(analysisOf({ lowTexture: true, nearbyCoverage: 0.2 }))).toBe(false);
  });

  it("keeps the cloud path for high-texture backgrounds", () => {
    expect(shouldExtractBackgroundLocally(analysisOf({ lowTexture: false, nearbyCoverage: 0.6 }))).toBe(false);
  });

  it("keeps the cloud path when analysis failed", () => {
    expect(shouldExtractBackgroundLocally(null)).toBe(false);
  });
});
