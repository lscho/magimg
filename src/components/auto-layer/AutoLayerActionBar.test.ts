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

  it("opens an upward package menu and routes both save formats", async () => {
    const wrapper = mount(AutoLayerActionBar, {
      props: { ...baseProps, canPackage: true, hasDocument: true }
    });
    const trigger = wrapper.findAll("button").find(button => button.text().includes("打包保存"));
    expect(trigger).toBeDefined();

    await trigger!.trigger("click");
    const menu = wrapper.get('[role="menu"]');
    expect(menu.text()).toContain("保存为 PSD");
    expect(menu.text()).toContain("保存为文件夹");
    expect(trigger!.attributes("aria-expanded")).toBe("true");

    await menu.findAll('[role="menuitem"]')[0].trigger("click");
    expect(wrapper.emitted("savePsd")).toHaveLength(1);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);

    await trigger!.trigger("click");
    await wrapper.get('[role="menu"]').findAll('[role="menuitem"]')[1].trigger("click");
    expect(wrapper.emitted("savePackage")).toHaveLength(1);
  });

  it("closes the package menu with Escape", async () => {
    const wrapper = mount(AutoLayerActionBar, {
      props: { ...baseProps, canPackage: true, hasDocument: true },
      attachTo: document.body
    });
    const trigger = wrapper.findAll("button").find(button => button.text().includes("打包保存"))!;
    await trigger.trigger("click");
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("disables only PSD while a PSD export is running", async () => {
    const wrapper = mount(AutoLayerActionBar, {
      props: { ...baseProps, canPackage: true, hasDocument: true, exportingPsd: true }
    });
    await wrapper.findAll("button").find(button => button.text().includes("打包保存"))!.trigger("click");
    const items = wrapper.get('[role="menu"]').findAll('[role="menuitem"]');
    expect(items[0].attributes("disabled")).toBeDefined();
    expect(items[0].attributes("aria-busy")).toBe("true");
    expect(items[1].attributes("disabled")).toBeUndefined();
  });

  it("does not open the package menu when no completed result exists", async () => {
    const wrapper = mount(AutoLayerActionBar, { props: baseProps });
    const trigger = wrapper.findAll("button").find(button => button.text().includes("打包保存"))!;
    expect(trigger.attributes("disabled")).toBeDefined();
    await trigger.trigger("click");
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });
});
