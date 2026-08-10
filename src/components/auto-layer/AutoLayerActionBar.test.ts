// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AutoLayerActionBar from "@/components/auto-layer/AutoLayerActionBar.vue";

const baseProps = {
  stage: "idle" as const,
  progress: null,
  resourceStatus: "ready" as const,
  resourceProgress: null,
  recognitionResourceStatus: "ready" as const,
  recognitionResourceProgress: 0,
  drawerOpen: false,
  hasDocument: false,
  canOpenDrawer: false,
  hasSelections: true,
  canPackage: false,
  canSaveSelections: true,
  canOpenSelectionHistory: true,
  selectionHistoryLoading: false,
  canRun: true,
  cost: 20,
  balance: 100,
  error: ""
};

describe("AutoLayerActionBar", () => {
  it("keeps the one-click action available when resources are missing", async () => {
    const wrapper = mount(AutoLayerActionBar, {
      props: {
        ...baseProps,
        resourceStatus: "missing",
        recognitionResourceStatus: "missing"
      }
    });

    expect(wrapper.text()).not.toContain("分层资源");
    const runButton = wrapper.get("button.run-button");
    expect(runButton.attributes("disabled")).toBeUndefined();
    expect(runButton.text()).toContain("一键分层");
    await runButton.trigger("click");
    expect(wrapper.emitted("run")).toHaveLength(1);
  });

  it("shows unified progress and prevents duplicate clicks while downloading", () => {
    const wrapper = mount(AutoLayerActionBar, {
      props: {
        ...baseProps,
        resourceStatus: "downloading",
        resourceProgress: { stage: "downloading", percent: 20 },
        recognitionResourceStatus: "downloading",
        recognitionResourceProgress: 80
      }
    });

    const runButton = wrapper.get("button.run-button");
    expect(runButton.attributes("disabled")).toBeDefined();
    expect(runButton.attributes("aria-busy")).toBe("true");
    expect(runButton.text()).toContain("下载资源 50%");
  });
});
