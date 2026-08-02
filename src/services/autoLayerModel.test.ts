import { describe, expect, it } from "vitest";
import {
  createAutoLayerItems,
  moveAutoLayer,
  resetAutoLayer,
  scaleAutoLayer,
  setAutoLayerKind
} from "@/services/autoLayerModel";

const material = {
  id: "selection-1",
  blob: new Blob(["layer"], { type: "image/png" }),
  width: 100,
  height: 50,
  sourceBox: { id: "selection-1", x: 20, y: 30, width: 100, height: 50 }
};

describe("auto layer model", () => {
  it("creates editable layers at their source coordinates", () => {
    const [layer] = createAutoLayerItems([material]);
    expect(layer).toMatchObject({
      id: "selection-1",
      kind: "material",
      x: 20,
      y: 30,
      width: 100,
      height: 50,
      visible: true
    });
  });

  it("keeps moved and scaled layers reachable from the canvas", () => {
    const [layer] = createAutoLayerItems([material]);
    const moved = moveAutoLayer(layer, 999, -100, 300, 200);
    expect(moved.x).toBe(200);
    expect(moved.y).toBe(0);

    const scaled = scaleAutoLayer(moved, 10, 300, 200);
    expect(scaled.width).toBe(400);
    expect(scaled.height).toBe(200);
    expect(scaled.x).toBe(0);
  });

  it("converts a material to editable text and resets its transform", () => {
    const [layer] = createAutoLayerItems([material]);
    const text = setAutoLayerKind(layer, "text");
    expect(text.kind).toBe("text");
    expect(text.text).toBe("输入文字");
    expect(resetAutoLayer({ ...text, x: 80, width: 200 })).toMatchObject({
      x: 20,
      y: 30,
      width: 100,
      height: 50
    });
  });
});
