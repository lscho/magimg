// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { BIRENET_MODEL } from "@/services/cutoutModelManager";

describe("BIRENET_MODEL", () => {
  it("downloads the pinned model from the shared resource mirror", () => {
    expect(BIRENET_MODEL.files[0]?.url)
      .toBe("https://download.atmomo.cn/model/birefnet-swin-tiny-general.onnx");
  });
});
