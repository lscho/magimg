import { describe, expect, it } from "vitest";
import {
  createAutoLayerBackgroundBoxes,
  createAutoLayerBackgroundRegions,
  keepLargestOverlappingBoxes,
  mergeConnectedBackgroundBoxes
} from "@/services/autoLayerBackgroundBoxes";

describe("automatic-layer background boxes", () => {
  it("keeps only the largest box from each overlapping group", () => {
    const boxes = keepLargestOverlappingBoxes([
      { id: "parent", x: 10, y: 10, width: 100, height: 100 },
      { id: "child", x: 20, y: 20, width: 20, height: 20 },
      { id: "independent", x: 150, y: 20, width: 30, height: 30 }
    ]);

    expect(boxes.map(box => box.id)).toEqual(["parent", "independent"]);
  });

  it("keeps adjacent targets whose selection edges overlap only slightly", () => {
    const boxes = keepLargestOverlappingBoxes([
      { id: "panel", x: 0, y: 0, width: 824, height: 412 },
      { id: "button", x: 20, y: 385, width: 228, height: 262 }
    ]);

    expect(boxes.map(box => box.id)).toEqual(["panel", "button"]);
  });

  it("merges shadow-expanded UI boxes that form one continuous row", () => {
    const boxes = mergeConnectedBackgroundBoxes([
      { id: "profile", x: 0, y: 0, width: 843, height: 431 },
      { id: "currency", x: 794, y: 18, width: 400, height: 211 },
      { id: "coins", x: 1165, y: 9, width: 371, height: 220 }
    ]);

    expect(boxes).toEqual([
      { id: "profile", x: 0, y: 0, width: 1536, height: 431 }
    ]);
  });

  it("does not merge boxes that only touch at a small corner", () => {
    const boxes = mergeConnectedBackgroundBoxes([
      { id: "first", x: 0, y: 0, width: 48, height: 48 },
      { id: "second", x: 42, y: 42, width: 56, height: 56 }
    ]);

    expect(boxes.map(box => box.id)).toEqual(["second", "first"]);
  });

  it("does not let connected UI groups grow into a page-sized repair region", () => {
    const regions = createAutoLayerBackgroundRegions([
      { id: "panel", x: 218, y: 133, width: 718, height: 423 },
      { id: "left-1", x: 1, y: 127, width: 213, height: 105 },
      { id: "left-2", x: 5, y: 235, width: 210, height: 111 }
    ], 941, 1672);

    expect(regions.selectionBoxes).toEqual([
      { id: "panel", x: 182, y: 97, width: 759, height: 495 },
      { id: "left-2", x: 0, y: 116, width: 226, height: 241 }
    ]);
  });

  it("expands retained boxes within image bounds for shadows and outlines", () => {
    const boxes = createAutoLayerBackgroundBoxes([
      { id: "top", x: 0, y: 0, width: 40, height: 40 },
      { id: "center", x: 50, y: 50, width: 40, height: 40 }
    ], 100, 100);

    expect(boxes).toEqual([
      { id: "center", x: 42, y: 42, width: 56, height: 56 },
      { id: "top", x: 0, y: 0, width: 48, height: 48 }
    ]);
  });

  it("caps large-panel padding while retaining its full drop-shadow margin", () => {
    const boxes = createAutoLayerBackgroundBoxes([
      { id: "panel", x: 80, y: 100, width: 1000, height: 400 }
    ], 1400, 800);

    expect(boxes).toEqual([
      { id: "panel", x: 32, y: 52, width: 1096, height: 496 }
    ]);
  });

  it("keeps exact composite boxes when expanded generation boxes are merged", () => {
    const regions = createAutoLayerBackgroundRegions([
      { id: "left", x: 0, y: 0, width: 48, height: 48 },
      { id: "right", x: 40, y: 0, width: 48, height: 48 }
    ], 300, 200);

    expect(regions.selectionBoxes).toHaveLength(1);
    expect(regions.selectionBoxes[0]).toMatchObject({ x: 0, y: 0, width: 96, height: 56 });
    expect(regions.compositeBoxes).toEqual([
      { id: "left", x: 0, y: 0, width: 48, height: 48 },
      { id: "right", x: 40, y: 0, width: 48, height: 48 }
    ]);
  });
});
