// @vitest-environment happy-dom

import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import CompressionSettingsDialog from "./CompressionSettingsDialog.vue";
import type { CompressionSettings } from "@/types";

const settings: CompressionSettings = {
  conflictPolicy: "rename",
  skipNoBenefit: true
};

let wrapper: VueWrapper | undefined;

function mountDialog() {
  wrapper = mount(CompressionSettingsDialog, {
    attachTo: document.body,
    props: {
      modelValue: { ...settings }
    }
  });
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

describe("CompressionSettingsDialog", () => {
  it("focuses the dialog when opened", () => {
    const dialog = mountDialog().get('[role="dialog"]');

    expect(document.activeElement).toBe(dialog.element);
  });

  it("saves edited output behavior and closes", async () => {
    const dialog = mountDialog();
    await dialog.get("select").setValue("overwrite");
    await dialog.get('input[type="checkbox"]').setValue(false);
    await dialog.get("form").trigger("submit");

    expect(dialog.emitted("update:modelValue")).toEqual([
      [{ conflictPolicy: "overwrite", skipNoBenefit: false }]
    ]);
    expect(dialog.emitted("close")).toHaveLength(1);
  });

  it("closes without saving when cancelled", async () => {
    const dialog = mountDialog();
    const cancel = dialog.findAll("button").find((button) => button.text() === "取消");
    expect(cancel).toBeDefined();

    await cancel!.trigger("click");

    expect(dialog.emitted("update:modelValue")).toBeUndefined();
    expect(dialog.emitted("close")).toHaveLength(1);
  });

  it("closes on Escape without saving", async () => {
    const dialog = mountDialog();
    await dialog.get('[role="dialog"]').trigger("keydown", { key: "Escape" });

    expect(dialog.emitted("update:modelValue")).toBeUndefined();
    expect(dialog.emitted("close")).toHaveLength(1);
  });
});
