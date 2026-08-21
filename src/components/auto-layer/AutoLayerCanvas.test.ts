// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AutoLayerCanvas from "@/components/auto-layer/AutoLayerCanvas.vue";
import type { AutoLayerItem } from "@/components/auto-layer/types";

const material: AutoLayerItem = {
  id: "material",
  name: "星星",
  kind: "material",
  blob: new Blob(),
  sourceBox: { id: "material", x: 10, y: 10, width: 20, height: 20 },
  sourceSelectionId: "material",
  parentId: null,
  recognitionConfidence: 1,
  elementType: "star",
  cleanedChildren: false,
  x: 10,
  y: 10,
  width: 20,
  height: 20,
  visible: true
};

const text: AutoLayerItem = {
  id: "text",
  name: "标题",
  kind: "text",
  blob: new Blob(),
  sourceBox: { id: "text", x: 20, y: 40, width: 50, height: 12 },
  sourceSelectionId: "text",
  parentId: null,
  recognitionConfidence: 1,
  text: "进入下一关",
  ocrConfidence: 1,
  fontSize: 12,
  fontWeight: 400,
  fontCategory: "sans",
  color: "#ffffff",
  x: 20,
  y: 40,
  width: 50,
  height: 12,
  visible: true
};

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(232);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(132);
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) =>
    blob === material.blob ? "blob:material" : blob === text.blob ? "blob:text" : "blob:background"
  );
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AutoLayerCanvas result interactions", () => {
  it("uses type cursors without drawing selection frames or scale handles", () => {
    const wrapper = mount(AutoLayerCanvas, {
      props: {
        backgroundBlob: new Blob(),
        imageWidth: 100,
        imageHeight: 100,
        layers: [material, text]
      }
    });

    const objects = wrapper.findAll(".auto-layer-object");
    expect(objects).toHaveLength(2);
    expect(objects[0].classes()).toContain("is-material");
    expect(objects[0].attributes("aria-label")).toContain("素材图层，可拖动");
    expect(objects[1].classes()).toContain("is-text");
    expect(objects[1].attributes("aria-label")).toContain("文字图层，可拖动，双击编辑");
    expect(wrapper.find(".is-selected").exists()).toBe(false);
    expect(wrapper.find(".auto-layer-scale-handle").exists()).toBe(false);
  });

  it("reports its natural fit and obeys a shared preview scale limit", async () => {
    const wrapper = mount(AutoLayerCanvas, {
      props: {
        backgroundBlob: new Blob(),
        imageWidth: 100,
        imageHeight: 100,
        layers: [],
        previewScaleLimit: 0.5
      }
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("fitScaleChange")?.at(-1)).toEqual([1]);
    expect(wrapper.get(".auto-layer-stage").attributes("style")).toContain("width: 50px");
    expect(wrapper.get(".auto-layer-stage").attributes("style")).toContain("height: 50px");
  });
});
