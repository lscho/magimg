import { describe, expect, it } from "vitest";
import {
  compositeAutoLayerCloudRgba,
  createAutoLayerCloudCompositeMask
} from "@/services/autoLayerCloudComposite";

describe("auto layer cloud output compositing", () => {
  const box = { id: "subject", x: 5, y: 5, width: 20, height: 20 };

  it("keeps every pixel outside submitted boxes and feathers inward", () => {
    const mask = createAutoLayerCloudCompositeMask(30, 30, [box]);
    expect(mask[4 * 30 + 10]).toBe(0);
    expect(mask[5 * 30 + 10]).toBe(0);
    expect(mask[6 * 30 + 10]).toBe(255);
    expect(mask[15 * 30 + 15]).toBe(255);
    expect(mask[25 * 30 + 10]).toBe(0);
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
});
