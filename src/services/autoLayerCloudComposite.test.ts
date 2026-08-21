import { describe, expect, it } from "vitest";
import {
  compositeAutoLayerCloudRgba,
  createAutoLayerCloudCompositeMask
} from "@/services/autoLayerCloudComposite";

describe("auto layer cloud output compositing", () => {
  const box = { id: "subject", x: 5, y: 5, width: 20, height: 20 };

  it("keeps every pixel outside allowed composite boxes and feathers inward", () => {
    const mask = createAutoLayerCloudCompositeMask(30, 30, [box]);
    expect(mask[4 * 30 + 10]).toBe(0);
    expect(mask[5 * 30 + 10]).toBe(0);
    expect(mask[6 * 30 + 10]).toBe(60);
    expect(mask[15 * 30 + 15]).toBe(255);
    expect(mask[25 * 30 + 10]).toBe(0);
  });

  it("does not feather against the outside of the image canvas", () => {
    const mask = createAutoLayerCloudCompositeMask(30, 20, [
      { id: "edge", x: 0, y: 0, width: 10, height: 20 }
    ]);

    expect(mask[0]).toBe(255);
    expect(mask[10 * 30]).toBe(255);
    expect(mask[10 * 30 + 9]).toBe(0);
    expect(mask[10 * 30 + 10]).toBe(0);
  });

  it("only adopts repaired RGB inside the feathered box and preserves source alpha", () => {
    const source = new Uint8ClampedArray(30 * 30 * 4);
    const repaired = new Uint8ClampedArray(30 * 30 * 4);
    for (let offset = 0; offset < source.length; offset += 4) {
      source.set([10, 20, 30, 77], offset);
      repaired.set([110, 120, 130, 255], offset);
    }
    const output = compositeAutoLayerCloudRgba(source, repaired, 30, 30, [box]);
    const outside = (4 * 30 + 10) * 4;
    const edge = (5 * 30 + 10) * 4;
    const inside = (15 * 30 + 15) * 4;
    expect([...output.slice(outside, outside + 4)]).toEqual([10, 20, 30, 77]);
    expect([...output.slice(edge, edge + 4)]).toEqual([10, 20, 30, 77]);
    expect([...output.slice(inside, inside + 4)]).toEqual([110, 120, 130, 77]);
  });

  it("preserves unselected pixels between separate composite boxes", () => {
    const mask = createAutoLayerCloudCompositeMask(40, 20, [
      { id: "left", x: 2, y: 2, width: 10, height: 16 },
      { id: "right", x: 28, y: 2, width: 10, height: 16 }
    ]);

    expect(mask[10 * 40 + 6]).toBe(255);
    expect(mask[10 * 40 + 20]).toBe(0);
    expect(mask[10 * 40 + 33]).toBe(255);
  });

  it("feathers only the outside of overlapping boxes", () => {
    const mask = createAutoLayerCloudCompositeMask(30, 20, [
      { id: "left", x: 2, y: 2, width: 18, height: 16 },
      { id: "right", x: 10, y: 2, width: 18, height: 16 }
    ]);

    expect(mask[10 * 30 + 10]).toBe(255);
    expect(mask[10 * 30 + 19]).toBe(255);
  });

  it("preserves source pixels in gaps between generated repair regions", () => {
    const width = 40;
    const height = 20;
    const source = new Uint8ClampedArray(width * height * 4);
    const repaired = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < source.length; offset += 4) {
      source.set([80, 90, 100, 255], offset);
      repaired.set([65, 75, 85, 255], offset);
    }
    const output = compositeAutoLayerCloudRgba(source, repaired, width, height, [
      { id: "left", x: 2, y: 2, width: 10, height: 16 },
      { id: "right", x: 28, y: 2, width: 10, height: 16 }
    ]);
    const left = (10 * width + 7) * 4;
    const gap = (10 * width + 20) * 4;
    const right = (10 * width + 33) * 4;

    expect([...output.slice(left, left + 4)]).toEqual([65, 75, 85, 255]);
    expect([...output.slice(gap, gap + 4)]).toEqual([80, 90, 100, 255]);
    expect([...output.slice(right, right + 4)]).toEqual([65, 75, 85, 255]);
  });

  it("matches the generated page color cast from pixels outside every repair box", () => {
    const width = 60;
    const height = 40;
    const source = new Uint8ClampedArray(width * height * 4);
    const repaired = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const generated = [40 + x * 2, 50 + y * 3, 60 + x + y];
        repaired.set([...generated, 255], offset);
        source.set([
          Math.round(generated[0] * 1.02 + 1),
          Math.round(generated[1] * 1.04 + 0.5),
          Math.round(generated[2] * 1.06 - 0.5),
          255
        ], offset);
      }
    }
    const box = { id: "subject", x: 20, y: 10, width: 20, height: 20 };
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        const offset = (y * width + x) * 4;
        source.set([240, 20, 20, 255], offset);
        repaired.set([120, 140, 160, 255], offset);
      }
    }
    const output = compositeAutoLayerCloudRgba(source, repaired, width, height, [box]);
    const inside = (20 * width + 30) * 4;
    const outside = (5 * width + 5) * 4;

    expect([...output.slice(inside, inside + 3)]).toEqual([123, 146, 169]);
    expect([...output.slice(outside, outside + 4)])
      .toEqual([...source.slice(outside, outside + 4)]);
  });

  it("clamps corrected channels when regression inputs use Node buffers", () => {
    const width = 60;
    const height = 40;
    const source = Buffer.alloc(width * height * 4);
    const repaired = Buffer.alloc(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const value = 40 + pixel % 160;
      repaired.set([value, value, value, 255], offset);
      source.set([
        Math.min(255, Math.round(value * 1.1 + 10)),
        Math.min(255, Math.round(value * 1.1 + 10)),
        Math.min(255, Math.round(value * 1.1 + 10)),
        255
      ], offset);
    }
    const box = { id: "subject", x: 20, y: 10, width: 20, height: 20 };
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        const offset = (y * width + x) * 4;
        repaired.set([250, 250, 250, 255], offset);
      }
    }

    const output = compositeAutoLayerCloudRgba(
      source as unknown as Uint8ClampedArray,
      repaired as unknown as Uint8ClampedArray,
      width,
      height,
      [box]
    );
    const inside = (20 * width + 30) * 4;
    expect([...output.slice(inside, inside + 3)]).toEqual([255, 255, 255]);
  });
});
