import { readPsd, writePsd, type Layer, type PixelData, type Psd } from "ag-psd";
import { describe, expect, it } from "vitest";
import type { AutoLayerItem } from "@/components/auto-layer/types";
import {
  buildAutoLayerPsdRootLayers,
  buildAutoLayerPsdTree
} from "@/services/autoLayerPsdExport";

const pixel: PixelData = {
  data: new Uint8ClampedArray([255, 0, 0, 255]),
  width: 1,
  height: 1
};

function material(id: string, parentId: string | null): AutoLayerItem {
  return {
    id,
    name: id,
    kind: "material",
    blob: new Blob(),
    sourceBox: { id, x: 0, y: 0, width: 1, height: 1 },
    sourceSelectionId: id,
    parentId,
    recognitionConfidence: 1,
    elementType: "element",
    cleanedChildren: false,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    visible: true
  };
}

describe("buildAutoLayerPsdTree", () => {
  it("writes parent material before descendants so Photoshop places it below them", () => {
    const parent = material("panel", null);
    const child = material("avatar", "panel");
    const prepared = new Map<string, Layer>([
      [parent.id, { name: parent.name, imageData: pixel }],
      [child.id, { name: child.name, imageData: pixel }]
    ]);
    const tree = buildAutoLayerPsdTree([parent, child], prepared);

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("panel");
    expect(tree[0].children?.map(layer => layer.name)).toEqual(["panel · 素材", "avatar"]);
  });

  it("writes readable PSD groups and editable text descriptors", () => {
    const textLayer: Layer = {
      name: "标题",
      left: 2,
      top: 3,
      right: 3,
      bottom: 4,
      imageData: pixel,
      text: {
        text: "幻画",
        transform: [1, 0, 0, 1, 2, 3],
        style: { font: { name: "MicrosoftYaHei" }, fontSize: 12 }
      }
    };
    const psd: Psd = {
      width: 4,
      height: 4,
      imageData: { data: new Uint8ClampedArray(4 * 4 * 4), width: 4, height: 4 },
      children: [textLayer]
    };
    const parsed = readPsd(writePsd(psd, { noBackground: true }), {
      skipCompositeImageData: true,
      skipLayerImageData: true
    });

    expect(parsed.children?.[0].name).toBe("标题");
    expect(parsed.children?.[0].text?.text).toBe("幻画");
    expect(parsed.children?.[0].left).toBe(2);
    expect(parsed.children?.[0].top).toBe(3);
  });

  it("keeps the background as the bottom Photoshop layer after writing", () => {
    const foreground = material("foreground", null);
    const prepared = new Map<string, Layer>([
      [foreground.id, { name: foreground.name, imageData: pixel }]
    ]);
    const background: Layer = { name: "背景", imageData: pixel };
    const children = buildAutoLayerPsdRootLayers([foreground], prepared, background);
    const psd: Psd = {
      width: 1,
      height: 1,
      imageData: pixel,
      children
    };
    const parsed = readPsd(writePsd(psd, { noBackground: true }), {
      skipCompositeImageData: true,
      skipLayerImageData: true
    });

    // ag-psd preserves this array through readPsd, while Photoshop displays it in reverse.
    expect(children.map(layer => layer.name)).toEqual(["背景", "foreground"]);
    expect(parsed.children?.map(layer => layer.name)).toEqual(["背景", "foreground"]);
    expect(children[0].name).toBe("背景");
  });
});
