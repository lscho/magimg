import { describe, expect, it } from "vitest";
import { assignAutoLayerNames } from "@/services/autoLayerNaming";

describe("automatic layer naming", () => {
  it("uses a unique English type and appends bg for a cleaned parent", () => {
    const names = assignAutoLayerNames([{
      id: "card", kind: "material", type: "card", confidence: 0.91,
      cleanedChildren: true, box: { id: "card", x: 20, y: 20, width: 300, height: 200 }
    }], 600, 800);
    expect(names.get("card")).toBe("card-bg");
  });

  it("prefixes duplicate roles by position and resolves collisions", () => {
    const names = assignAutoLayerNames([
      { id: "a", kind: "material", type: "btn", confidence: 0.9, box: { id: "a", x: 20, y: 20, width: 100, height: 40 } },
      { id: "b", kind: "material", type: "btn", confidence: 0.9, box: { id: "b", x: 180, y: 20, width: 100, height: 40 } }
    ], 400, 400);
    expect(names.get("a")).toBe("top-btn");
    expect(names.get("b")).toBe("top-btn-2");
  });

  it("falls back to position plus element on low confidence", () => {
    const names = assignAutoLayerNames([{
      id: "unknown", kind: "material", type: "badge", confidence: 0.2,
      box: { id: "unknown", x: 180, y: 180, width: 40, height: 40 }
    }], 400, 400);
    expect(names.get("unknown")).toBe("center-element");
  });
});
