// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { CUTOUT_REFINER } from "@/services/cutoutRefinerManager";

describe("CUTOUT_REFINER", () => {
  it("reuses the AI cutout resource prefix", () => {
    expect(CUTOUT_REFINER.url)
      .toBe("https://download.atmomo.cn/model/vitmatte-base-composition-1k.onnx");
  });
});
