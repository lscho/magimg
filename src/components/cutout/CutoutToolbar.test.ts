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
      brushRadius: 24,
      smartBrush: false,
      ...overrides
    }
  });
}

describe("CutoutToolbar smart selection", () => {
  it("uses the first toolbar icon to import an image directly", () => {
    const wrapper = mountToolbar();
    expect(wrapper.findAll('button')[0].attributes("aria-label")).toBe("导入图片");

    const autoLayer = mountToolbar({ mode: "auto-layer" });
    expect(autoLayer.findAll('button')[0].attributes("aria-label")).toBe("导入图片");
  });

  it("emits smartSelect from the desktop toolbar button", async () => {
    const wrapper = mountToolbar();
    await wrapper.get('button[aria-label="智能框选"]').trigger("click");
    expect(wrapper.emitted("smartSelect")).toHaveLength(1);
  });

  it("shows one background-repair brush with smart snap disabled", async () => {
    const wrapper = mountToolbar({ activeTool: "erase" });
    const panel = wrapper.get('[aria-label="背景修复属性"]');
    const smartBrush = panel.get('input[type="checkbox"]');

    expect(panel.text()).toContain("背景修复");
    expect(panel.text()).not.toContain("添加");
    expect(panel.text()).not.toContain("恢复");
    expect(panel.text()).not.toContain("独立提取");
    expect((smartBrush.element as HTMLInputElement).checked).toBe(false);

    await smartBrush.setValue(true);
    expect(wrapper.emitted("setSmartBrush")).toEqual([[true]]);
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
