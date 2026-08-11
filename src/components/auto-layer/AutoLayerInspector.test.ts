// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AutoLayerInspector from "@/components/auto-layer/AutoLayerInspector.vue";
import type { AutoLayerMaterialItem } from "@/components/auto-layer/types";

function layer(id: string, x: number): AutoLayerMaterialItem {
  return {
    id,
    name: id,
    kind: "material",
    blob: new Blob(),
    sourceBox: { id, x, y: 20, width: 80, height: 40 },
    sourceSelectionId: id,
    parentId: null,
    recognitionConfidence: 1,
    elementType: "element",
    cleanedChildren: false,
    x: x + 30,
    y: 60,
    width: 120,
    height: 60,
    visible: true
  };
}

describe("AutoLayerInspector", () => {
  it("restores the position and size of every layer from one action", async () => {
    const wrapper = mount(AutoLayerInspector, {
      props: {
        layers: [layer("first", 10), layer("second", 140)],
        selectedId: "first",
        imageWidth: 400,
        imageHeight: 300
      }
    });

    await wrapper.get("button.auto-layer-reset-button").trigger("click");

    const emitted = wrapper.emitted("updateLayers");
    expect(emitted).toHaveLength(1);
    expect((emitted?.[0]?.[0] as AutoLayerMaterialItem[]).map(item => ({
      id: item.id,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height
    }))).toEqual([
      { id: "first", x: 10, y: 20, width: 80, height: 40 },
      { id: "second", x: 140, y: 20, width: 80, height: 40 }
    ]);
  });
});
