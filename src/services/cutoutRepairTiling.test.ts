import { describe, expect, it } from "vitest";
import {
  buildRepairTileAxis,
  MAX_REPAIR_TILES,
  repairTileAxisWeight,
  repairTileHasMask,
  REPAIR_TILE_MIN_STEP,
  REPAIR_TILE_SIZE
} from "@/services/cutoutRepairTiling";

function weightSum(starts: readonly number[], tileSize: number, position: number) {
  let sum = 0;
  for (let index = 0; index < starts.length; index += 1) {
    sum += repairTileAxisWeight(index, starts, tileSize, position);
  }
  return sum;
}

describe("repair tile axis layout", () => {
  it("uses a single tile when the size fits", () => {
    const axis = buildRepairTileAxis(512);
    expect(axis.count).toBe(1);
    expect(axis.starts).toEqual([0]);
    expect(repairTileAxisWeight(0, axis.starts, REPAIR_TILE_SIZE, 300)).toBe(1);
  });

  it("covers the whole span with ascending starts", () => {
    for (const size of [513, 600, 800, 1080, 1500, 2000, 3840]) {
      const axis = buildRepairTileAxis(size);
      expect(axis.starts[0]).toBe(0);
      expect(axis.starts[axis.count - 1]).toBe(size - REPAIR_TILE_SIZE);
      for (let index = 1; index < axis.count; index += 1) {
        expect(axis.starts[index]).toBeGreaterThan(axis.starts[index - 1]);
        expect(axis.starts[index] - axis.starts[index - 1])
          .toBeLessThanOrEqual(REPAIR_TILE_MIN_STEP);
        // 相邻瓦片必须互相覆盖，不能留缝。
        expect(axis.starts[index]).toBeLessThan(axis.starts[index - 1] + REPAIR_TILE_SIZE);
      }
    }
  });

  it("keeps every covered position at total weight 1", () => {
    for (const size of [513, 600, 700, 1080, 1500, 2000, 3840, 4000]) {
      const axis = buildRepairTileAxis(size);
      for (let position = 0; position < size; position += 7) {
        expect(weightSum(axis.starts, REPAIR_TILE_SIZE, position)).toBeCloseTo(1, 6);
      }
    }
  });

  it("keeps the tile count within the model-call budget for large areas", () => {
    expect(buildRepairTileAxis(3840).count).toBeLessThanOrEqual(MAX_REPAIR_TILES);
    expect(buildRepairTileAxis(4000).count).toBe(11);
  });

  it("feathers down to zero at interior cut edges and one outside the overlap", () => {
    const axis = buildRepairTileAxis(1080);
    const [first, second, third] = axis.starts;
    const leftOverlap = first + REPAIR_TILE_SIZE - second;
    expect(repairTileAxisWeight(0, axis.starts, REPAIR_TILE_SIZE, first)).toBe(1);
    expect(repairTileAxisWeight(1, axis.starts, REPAIR_TILE_SIZE, second)).toBeCloseTo(0, 6);
    expect(repairTileAxisWeight(1, axis.starts, REPAIR_TILE_SIZE, second + 1)).toBeGreaterThan(0);
    expect(repairTileAxisWeight(1, axis.starts, REPAIR_TILE_SIZE, second + leftOverlap))
      .toBeCloseTo(1, 6);
    expect(repairTileAxisWeight(2, axis.starts, REPAIR_TILE_SIZE, third)).toBeCloseTo(0, 6);
    expect(repairTileAxisWeight(2, axis.starts, REPAIR_TILE_SIZE, 1080 - 1)).toBe(1);
  });

  it("detects mask pixels inside a tile and ignores empty tiles", () => {
    const mask = new Uint8Array(1000 * 800);
    expect(repairTileHasMask(mask, 1000, 800, 0, 0, 512, 512)).toBe(false);
    mask[100 + 300 * 1000] = 255;
    expect(repairTileHasMask(mask, 1000, 800, 0, 0, 512, 512)).toBe(true);
    expect(repairTileHasMask(mask, 1000, 800, 512, 0, 512, 512)).toBe(false);
    mask[600 + 100 * 1000] = 20;
    expect(repairTileHasMask(mask, 1000, 800, 512, 0, 512, 512)).toBe(false);
  });
});
