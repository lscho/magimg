// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CutoutToolbar from "@/components/cutout/CutoutToolbar.vue";

function mountToolbar(overrides: Record<string, unknown> = {}) {
  return mount(CutoutToolbar, {
    props: {
      activeTool: "box",
      busy: false,
      ready: true,
      canClear: false,
      canUndo: false,
      canRedo: false,
      zoomPercent: 100,
      importing: false,
      clearing: false,
      activeSelection: null,
      brushOperation: "add",
      brushRadius: 24,
      smartBrush: true,
      ...overrides
    }
  });
}

describe("CutoutToolbar smart selection", () => {
  it("emits smartSelect from the desktop toolbar button", async () => {
    const wrapper = mountToolbar();
    await wrapper.get('button[aria-label="智能框选"]').trigger("click");
    expect(wrapper.emitted("smartSelect")).toHaveLength(1);
  });

  it("shows a disabled browser boundary and a stable loading state", () => {
    const unavailable = mountToolbar({ smartSelectionAvailable: false });
    const unavailableButton = unavailable.get('button[aria-label="智能框选"]');
    expect(unavailableButton.attributes("disabled")).toBeDefined();
    expect(unavailableButton.attributes("data-tooltip")).toContain("桌面客户端");

    const loading = mountToolbar({ smartSelecting: true });
    const loadingButton = loading.get('button[aria-label="智能框选"]');
    expect(loadingButton.attributes("aria-busy")).toBe("true");
    expect(loadingButton.find(".cutout-tool-spinner").exists()).toBe(true);
  });

  it("exposes an adjustable smart-selection threshold", async () => {
    const wrapper = mountToolbar({ smartSelectionThreshold: 0.84 });
    const slider = wrapper.get('input[aria-label="智能框选强度"]');

    expect(slider.attributes("min")).toBe("0.8");
    expect(slider.attributes("max")).toBe("0.99");
    expect(wrapper.get(".smart-selection-threshold output").text()).toBe("84%");

    await slider.setValue("0.91");
    expect(wrapper.emitted("updateSmartSelectionThreshold")).toEqual([[0.91]]);
  });
});
