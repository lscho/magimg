import { describe, expect, it } from "vitest";
import { resolveAutoLayerRecognitionResourceUrl } from "@/services/autoLayerRecognitionModelManager";

describe("resolveAutoLayerRecognitionResourceUrl", () => {
  it("reuses the AI cutout resource prefix", () => {
    expect(resolveAutoLayerRecognitionResourceUrl("auto-layer-ocr-det.onnx"))
      .toBe("https://download.atmomo.cn/model/auto-layer-ocr-det.onnx");
    expect(resolveAutoLayerRecognitionResourceUrl("auto-layer-ocr-inference.yml"))
      .toBe("https://download.atmomo.cn/model/auto-layer-ocr-inference.yml");
  });
});
