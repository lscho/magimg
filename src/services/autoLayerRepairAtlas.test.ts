import { describe, expect, it } from "vitest";
import {
  autoLayerAtlasFileName,
  AUTO_LAYER_ATLAS_SPLIT_SCALE,
  layoutAutoLayerRepairTiles,
  nextAutoLayerAtlasPixelBudget,
  replaceAutoLayerTileRgb,
  shouldSplitAutoLayerAtlas
} from "@/services/autoLayerRepairAtlas";

describe("automatic-layer cloud repair atlas", () => {
  it("packs the full page and every parent crop into one bounded image", () => {
    const layout = layoutAutoLayerRepairTiles([
      { key: "background", width: 720, height: 1280 },
      { key: "material:card", width: 420, height: 320 },
      { key: "material:nav", width: 680, height: 180 }
    ], 4_000_000, 2048);

    expect(layout.placements.map(tile => tile.key)).toEqual([
      "background",
      "material:card",
      "material:nav"
    ]);
    expect(layout.width * layout.height).toBeLessThanOrEqual(4_000_000);
    expect(layout.width).toBeLessThanOrEqual(2048);
    expect(layout.height).toBeLessThanOrEqual(2048);
  });

  it("scales the whole atlas together when the native tiles exceed the pixel budget", () => {
    const layout = layoutAutoLayerRepairTiles([
      { key: "background", width: 2400, height: 3200 },
      { key: "material:panel", width: 1800, height: 1400 }
    ], 4_000_000, 2048);

    expect(layout.scale).toBeLessThan(1);
    expect(layout.width * layout.height).toBeLessThanOrEqual(4_000_000);
  });

  it("reduces the next pixel budget from the actual encoded byte overflow", () => {
    const next = nextAutoLayerAtlasPixelBudget(
      16_000_000,
      15 * 1024 * 1024,
      512 * 1024,
      10 * 1024 * 1024
    );

    expect(next).toBeLessThan(10_000_000);
    expect(next).toBeGreaterThan(1);
  });

  it("uses a file extension matching the encoded atlas format", () => {
    expect(autoLayerAtlasFileName(new Blob([], { type: "image/webp" }))).toBe("auto-layer-repair-atlas.webp");
    expect(autoLayerAtlasFileName(new Blob([], { type: "image/png" }))).toBe("auto-layer-repair-atlas.png");
  });

  it("uses the server-composited RGB once while preserving the material alpha", () => {
    const source = new Uint8ClampedArray([20, 30, 40, 96, 50, 60, 70, 0]);
    const repaired = new Uint8ClampedArray([200, 210, 220, 255, 80, 90, 100, 255]);

    expect([...replaceAutoLayerTileRgb(source, repaired)]).toEqual([
      200, 210, 220, 96,
      80, 90, 100, 0
    ]);
  });

  it("splits the atlas only when parent crops are present and scaling drops below the threshold", () => {
    expect(shouldSplitAutoLayerAtlas(0.99, true)).toBe(false);
    expect(shouldSplitAutoLayerAtlas(0.89, true)).toBe(true);
    expect(shouldSplitAutoLayerAtlas(0.5, true)).toBe(true);
    // 没有父素材时整页背景单独打包，不需要拆分。
    expect(shouldSplitAutoLayerAtlas(0.5, false)).toBe(false);
    expect(shouldSplitAutoLayerAtlas(AUTO_LAYER_ATLAS_SPLIT_SCALE, true)).toBe(false);
  });

  it("keeps the full page at native scale when split alone, while the combined atlas shrinks", () => {
    const combined = layoutAutoLayerRepairTiles([
      { key: "background", width: 3600, height: 2700 },
      { key: "material:panel", width: 2000, height: 1500 }
    ], 16_777_216, 3840);
    const backgroundOnly = layoutAutoLayerRepairTiles([
      { key: "background", width: 3600, height: 2700 }
    ], 16_777_216, 3840);
    const materialsOnly = layoutAutoLayerRepairTiles([
      { key: "material:panel", width: 2000, height: 1500 }
    ], 16_777_216, 3840);

    expect(combined.scale).toBeLessThan(0.9);
    expect(backgroundOnly.scale).toBeCloseTo(1, 6);
    expect(materialsOnly.scale).toBeCloseTo(1, 6);
    expect(backgroundOnly.width * backgroundOnly.height).toBeLessThanOrEqual(16_777_216);
    expect(materialsOnly.width * materialsOnly.height).toBeLessThanOrEqual(16_777_216);
  });

});
