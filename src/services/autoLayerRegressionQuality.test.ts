import { describe, expect, it } from "vitest";
import qualityCase from "../../tests/auto-layer.case.json";
import { parseAutoLayerRegressionCase } from "@/services/autoLayerRegressionQuality";

describe("automatic-layer regression quality case", () => {
  it("accepts the checked-in 24-selection regression case", () => {
    const parsed = parseAutoLayerRegressionCase(qualityCase);
    expect(parsed.selectionCount).toBe(24);
    expect(parsed.materialCount).toBe(18);
    expect(parsed.materialQualityOverrides).toEqual([
      {
        selectionId: "cutout-sel-1785758265448-6",
        minimumSolidRatio: 0.59,
        minimumBoundsHeightRatio: 0.69
      },
      {
        selectionId: "cutout-sel-1785758267660-7",
        minimumSolidRatio: 0.58,
        minimumBoundsHeightRatio: 0.65
      }
    ]);
    expect(parsed.expectedTexts.map(item => item.text)).toEqual([
      "前往",
      "5",
      "10",
      "完成修行任务",
      "修行奖励",
      "(0/3)"
    ]);
  });

  it("rejects an incomplete quality case", () => {
    expect(() => parseAutoLayerRegressionCase({ schemaVersion: 1 })).toThrow(
      "自动分层回归用例字段不完整"
    );
  });

  it("rejects duplicate or out-of-range material quality overrides", () => {
    expect(() => parseAutoLayerRegressionCase({
      ...qualityCase,
      materialQualityOverrides: [
        { selectionId: "panel", minimumSolidRatio: 0.5 },
        { selectionId: "panel", minimumBoundsHeightRatio: 0.7 }
      ]
    })).toThrow("自动分层回归用例字段不完整");
    expect(() => parseAutoLayerRegressionCase({
      ...qualityCase,
      materialQualityOverrides: [{ selectionId: "panel", minimumSolidRatio: 1.1 }]
    })).toThrow("自动分层回归用例字段不完整");
  });
});
