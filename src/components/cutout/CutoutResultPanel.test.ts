// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CutoutResultPanel from "@/components/cutout/CutoutResultPanel.vue";

describe("CutoutResultPanel background repair", () => {
  it("keeps background repair local without a mode selector", () => {
    const wrapper = mount(CutoutResultPanel, {
      props: {
        results: [],
        phase: "idle",
        resourceStatus: "ready",
        resourceProgress: null,
        progress: null,
        error: "",
        copyingId: null,
        savingId: null,
        exportingAll: false,
        hasImage: true,
        selectionCount: 1,
        hasBackgroundSelections: true,
        repairResourceStatus: "ready",
        repairProgress: null,
        localModelsSupported: true,
        cost: 5,
        balance: 100,
        isLoggedIn: true,
        insufficientCredits: false
      }
    });

    expect(wrapper.find('[aria-labelledby="cutout-repair-mode-heading"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("云端");
    expect(wrapper.findAll("button").some(button => button.text().trim() === "本地")).toBe(false);
  });
});
