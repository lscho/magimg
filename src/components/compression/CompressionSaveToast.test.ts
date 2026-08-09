// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CompressionSaveToast from "./CompressionSaveToast.vue";

describe("CompressionSaveToast", () => {
  it("announces the save result as a polite status", () => {
    const wrapper = mount(CompressionSaveToast, {
      props: { message: "已保存 2 个压缩结果" }
    });

    const toast = wrapper.get('[role="status"]');
    expect(toast.attributes("aria-live")).toBe("polite");
    expect(toast.text()).toContain("已保存 2 个压缩结果");
  });

  it("can be dismissed manually", async () => {
    const wrapper = mount(CompressionSaveToast, {
      props: { message: "已保存 1 个压缩结果" }
    });

    await wrapper.get('button[aria-label="关闭保存提醒"]').trigger("click");
    expect(wrapper.emitted("dismiss")).toHaveLength(1);
  });
});
