import { describe, expect, it } from "vitest";
import {
  createCutoutTrimap,
  createCutoutTrimapDetails,
  detectSolidBorderBackground,
  refineSolidBackgroundEdgeAlpha
} from "@/services/cutoutTrimap";

function opaqueImage(width: number, height: number, color: readonly [number, number, number]) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba.set([...color, 255], pixel * 4);
  }
  return rgba;
}

function fillRect(
  rgba: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  color: readonly [number, number, number]
) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      rgba.set([...color, 255], (y * width + x) * 4);
    }
  }
}

describe("cutout trimap", () => {
  it("keeps solid background pixels as definite background inside a coarse silhouette", () => {
    const width = 64;
    const height = 48;
    const rgba = opaqueImage(width, height, [255, 255, 255]);
    fillRect(rgba, width, 12, 8, 52, 40, [36, 54, 224]);
    fillRect(rgba, width, 28, 18, 37, 31, [255, 255, 255]);
    const alpha = new Uint8Array(width * height);
    for (let y = 8; y < 40; y += 1) {
      alpha.fill(255, y * width + 12, y * width + 52);
    }

    const background = detectSolidBorderBackground(rgba, width, height);
    const trimap = createCutoutTrimap(alpha, rgba, width, height);

    expect(background).toMatchObject({ red: 255, green: 255, blue: 255 });
    expect(trimap[24 * width + 32]).toBe(0);
    expect(trimap[24 * width + 20]).toBe(255);
    expect(trimap[2 * width + 2]).toBe(0);
  });

  it("does not chroma-key a crop whose border is not a uniform background", () => {
    const width = 64;
    const height = 48;
    const rgba = opaqueImage(width, height, [255, 255, 255]);
    const borderColors = [
      [210, 42, 52],
      [28, 142, 218],
      [48, 176, 92],
      [232, 180, 44]
    ] as const;
    for (let x = 0; x < width; x += 1) {
      rgba.set([...borderColors[x % borderColors.length], 255], x * 4);
      rgba.set([...borderColors[(x + 2) % borderColors.length], 255], ((height - 1) * width + x) * 4);
    }
    for (let y = 0; y < height; y += 1) {
      rgba.set([...borderColors[(y + 1) % borderColors.length], 255], (y * width) * 4);
      rgba.set([...borderColors[(y + 3) % borderColors.length], 255], (y * width + width - 1) * 4);
    }
    const alpha = new Uint8Array(width * height).fill(255);

    expect(detectSolidBorderBackground(rgba, width, height)).toBeNull();
    expect(createCutoutTrimap(alpha, rgba, width, height)[24 * width + 32]).toBe(255);
  });

  it("preserves a uniform subject when coarse alpha reaches the crop border", () => {
    const width = 64;
    const height = 48;
    const rgba = opaqueImage(width, height, [248, 248, 248]);
    const alpha = new Uint8Array(width * height).fill(255);

    expect(detectSolidBorderBackground(rgba, width, height)).not.toBeNull();
    expect(createCutoutTrimap(alpha, rgba, width, height)[24 * width + 32]).toBe(255);
  });

  it("caps near-background halo alpha without changing definite foreground", () => {
    const width = 64;
    const height = 48;
    const rgba = opaqueImage(width, height, [255, 255, 255]);
    fillRect(rgba, width, 16, 10, 48, 38, [42, 54, 224]);
    fillRect(rgba, width, 15, 9, 49, 10, [235, 236, 252]);
    fillRect(rgba, width, 15, 38, 49, 39, [235, 236, 252]);
    const coarseAlpha = new Uint8Array(width * height);
    for (let y = 9; y < 39; y += 1) {
      coarseAlpha.fill(255, y * width + 15, y * width + 49);
    }
    const { trimap, solidBackground } = createCutoutTrimapDetails(
      coarseAlpha,
      rgba,
      width,
      height
    );
    const refinedAlpha = coarseAlpha.slice();

    refineSolidBackgroundEdgeAlpha(
      refinedAlpha,
      width,
      rgba,
      trimap,
      width,
      height,
      solidBackground
    );

    expect(trimap[9 * width + 32]).toBe(128);
    expect(refinedAlpha[9 * width + 32]).toBeLessThan(80);
    expect(refinedAlpha[24 * width + 32]).toBe(255);
  });

  it("rejects mismatched image planes", () => {
    expect(() => createCutoutTrimap(
      new Uint8Array(4),
      new Uint8ClampedArray(12),
      2,
      2
    )).toThrow("尺寸不匹配");
  });
});
