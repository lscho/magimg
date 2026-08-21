// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";

const chooseImageFiles = vi.hoisted(() => vi.fn());
vi.mock("@/services/desktop", () => ({
  chooseImageFiles,
  selectedImageFileFromFile: (file: File) => ({ name: file.name, path: file.name, file })
}));

import ReferenceImageUploader from "@/components/ReferenceImageUploader.vue";
import type { SelectedImageFile } from "@/types";

function selected(name: string, type = "image/png"): SelectedImageFile {
  const file = new File([new Uint8Array([1])], name, { type });
  return { name, path: name, file };
}

describe("ReferenceImageUploader", () => {
  beforeEach(() => {
    chooseImageFiles.mockReset();
    vi.spyOn(URL, "createObjectURL").mockImplementation(file => `blob:${(file as File).name}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("selects at most three reference images and removes one", async () => {
    const images = [selected("one.png"), selected("two.jpg", "image/jpeg"), selected("three.webp", "image/webp")];
    chooseImageFiles.mockResolvedValue(images);
    const wrapper = mount(ReferenceImageUploader, {
      props: {
        referenceImages: [],
        maxBytes: 1024,
        maxImages: 3,
        "onUpdate:referenceImages": async (value: SelectedImageFile[]) => {
          await wrapper.setProps({ referenceImages: value });
        }
      }
    });

    await wrapper.get(".upload-zone").trigger("click");
    await nextTick();
    expect(chooseImageFiles).toHaveBeenCalledWith(3);
    expect(wrapper.findAll(".reference-item")).toHaveLength(3);
    expect(wrapper.find(".reference-add").exists()).toBe(false);

    await wrapper.findAll(".reference-delete")[1]?.trigger("click");
    await wrapper.get(".confirm-delete-button").trigger("click");
    await nextTick();
    expect(wrapper.findAll(".reference-item")).toHaveLength(2);
    expect(wrapper.text()).not.toContain("two.jpg");
  });
});
