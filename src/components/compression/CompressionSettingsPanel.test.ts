// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CompressionSettingsPanel from "./CompressionSettingsPanel.vue";
import { compressionWorkspaceItem } from "@/composables/useImageCompression";
import type { CompressionSourceItem, CompressionSummary } from "@/types";

const source: CompressionSourceItem = {
  id: "item-1",
  relativePath: "photo.png",
  format: "png",
  width: 1200,
  height: 800,
  size: 1000
};

const summary: CompressionSummary = {
  total: 1,
  succeeded: 1,
  noBenefit: 0,
  skipped: 0,
  failed: 0,
  cancelled: 0,
  originalBytes: 1000,
  outputBytes: 650,
  savedBytes: 350,
  wasCancelled: false
};

describe("CompressionSettingsPanel", () => {
  it("does not ask for an output folder before compression", () => {
    const wrapper = mount(CompressionSettingsPanel, { props: { canStart: true } });

    expect(wrapper.text()).toContain("开始压缩");
    expect(wrapper.text()).not.toContain("保存结果");
    expect(wrapper.text()).not.toContain("输出文件夹");
  });

  it("offers saving only after a successful compression", async () => {
    const item = {
      ...compressionWorkspaceItem(source),
      status: "succeeded" as const,
      outputSize: 650,
      savedPercent: 35
    };
    const wrapper = mount(CompressionSettingsPanel, {
      props: { items: [item], summary, canSave: true }
    });

    const button = wrapper.get(".results-footer .primary-button");
    expect(button.text()).toContain("保存结果");
    await button.trigger("click");
    expect(wrapper.emitted("save")).toHaveLength(1);
  });

  it("does not keep a save summary or output directory in the results panel", () => {
    const item = {
      ...compressionWorkspaceItem(source),
      status: "succeeded" as const,
      outputRelativePath: "nested/photo (1).png",
      outputSize: 650,
      savedPercent: 35,
      saveStatus: "saved" as const
    };
    const wrapper = mount(CompressionSettingsPanel, {
      props: { items: [item], summary, canSave: true, hasSaved: true }
    });

    expect(wrapper.text()).toContain("再次保存");
    expect(wrapper.text()).not.toContain("已保存 1 个压缩结果");
    expect(wrapper.text()).not.toContain("输出文件夹");
  });

  it("shows a locked saving state while results are written", () => {
    const wrapper = mount(CompressionSettingsPanel, {
      props: { summary, canSave: true, saving: true }
    });

    const button = wrapper.get(".results-footer .primary-button");
    expect(button.text()).toContain("正在保存");
    expect(button.attributes("disabled")).toBeDefined();
  });
});
