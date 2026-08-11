// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AutoLayerCanvas from "@/components/auto-layer/AutoLayerCanvas.vue";
import AutoLayerInspector from "@/components/auto-layer/AutoLayerInspector.vue";
import AutoLayerResultWorkspace from "@/components/auto-layer/AutoLayerResultWorkspace.vue";
import type { AutoLayerDocument, AutoLayerItem } from "@/components/auto-layer/types";

function material(id: string): AutoLayerItem {
  return {
    id,
    name: id,
    kind: "material",
    blob: new Blob(),
    sourceBox: { id, x: 0, y: 0, width: 20, height: 20 },
    sourceSelectionId: id,
    parentId: null,
    recognitionConfidence: 1,
    elementType: "element",
    cleanedChildren: false,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    visible: true
  };
}

function document(status: AutoLayerDocument["status"], layers: AutoLayerItem[] = []): AutoLayerDocument {
  return {
    backgroundBlob: new Blob(),
    width: 100,
    height: 100,
    layers,
    status
  };
}

function mountWorkspace(value: AutoLayerDocument) {
  return mount(AutoLayerResultWorkspace, {
    props: { document: value },
    global: {
      stubs: {
        AutoLayerCanvas: true,
        AutoLayerInspector: true
      }
    }
  });
}

describe("AutoLayerResultWorkspace selection", () => {
  it("starts with no selected layer and has no standalone PSD action", () => {
    const wrapper = mountWorkspace(document("complete", [material("title")]));
    expect(wrapper.find('button[aria-label="下载 PSD"]').exists()).toBe(false);
    expect(wrapper.findComponent(AutoLayerCanvas).props("selectedId")).toBeNull();
    expect(wrapper.findComponent(AutoLayerInspector).props("selectedId")).toBeNull();
  });

  it("clears a selection when its layer disappears instead of selecting another layer", async () => {
    const title = material("title");
    const panel = material("panel");
    const wrapper = mountWorkspace(document("complete", [panel, title]));
    wrapper.findComponent(AutoLayerCanvas).vm.$emit("select", title.id);
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent(AutoLayerInspector).props("selectedId")).toBe(title.id);

    await wrapper.setProps({ document: document("complete", [panel]) });
    expect(wrapper.findComponent(AutoLayerCanvas).props("selectedId")).toBeNull();
    expect(wrapper.findComponent(AutoLayerInspector).props("selectedId")).toBeNull();
  });
});
