import { describe, expect, it } from "vitest";
import {
  autoLayerAtlasFileName,
  layoutAutoLayerRepairTiles,
  nextAutoLayerAtlasPixelBudget,
  replaceAutoLayerTileRgb
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

});
