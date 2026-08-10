import { describe, expect, it } from "vitest";
import { decontaminateCutoutRgba } from "@/services/cutoutExport";

describe("cutout edge color decontamination", () => {
  it("removes hidden RGB outside alpha and subtracts the sampled background from soft edges", () => {
    const pixels = new Uint8ClampedArray([
      20, 180, 200, 255,
      110, 100, 100, 255,
      200, 20, 0, 255
    ]);
    const mask = new Uint8Array([0, 128, 255]);

    decontaminateCutoutRgba(pixels, mask, 3, 0, 0, 3, 1);

    expect([...pixels.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
    expect(pixels[7]).toBe(128);
    expect(pixels[4]).toBeGreaterThan(180);
    expect(pixels[5]).toBeLessThan(40);
    expect([...pixels.subarray(8, 12)]).toEqual([200, 20, 0, 255]);
  });
});
