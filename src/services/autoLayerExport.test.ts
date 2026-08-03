import { beforeEach, describe, expect, it, vi } from "vitest";

const renderAutoLayerTextAsset = vi.hoisted(() => vi.fn());
vi.mock("@/services/autoLayerRecognition", () => ({ renderAutoLayerTextAsset }));

import { buildAutoLayerManifest, renderAutoLayerAsset } from "@/services/autoLayerExport";
import type { AutoLayerDocument } from "@/components/auto-layer/types";

describe("automatic layer export manifest", () => {
  beforeEach(() => renderAutoLayerTextAsset.mockReset());
  it("records schema, transforms, order and parent relationships", () => {
    const document: AutoLayerDocument = {
      status: "complete", width: 400, height: 300, backgroundBlob: new Blob(),
      layers: [{
        id: "button", name: "top-btn", kind: "material", blob: new Blob(),
        sourceBox: { id: "button", x: 20, y: 30, width: 100, height: 40 },
        sourceSelectionId: "button", parentId: "card", recognitionConfidence: 0.9,
        elementType: "btn", cleanedChildren: false, x: 30, y: 40, width: 120, height: 48, visible: false
      }]
    };
    const manifest = buildAutoLayerManifest(document, new Map([["button", "top-btn"]]));
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      canvas: { width: 400, height: 300 },
      layers: [{ name: "top-btn", file: "assets/top-btn.png", parentId: "card", visible: false, x: 30, width: 120 }]
    });
  });

  it("renders text assets from the latest editable properties", async () => {
    const current = new Blob(["current"]);
    renderAutoLayerTextAsset.mockResolvedValue(current);
    const layer = {
      id: "text", name: "top-text", kind: "text" as const, blob: new Blob(["stale"]),
      sourceBox: { id: "text", x: 0, y: 0, width: 120, height: 30 },
      sourceSelectionId: "selection", parentId: null, recognitionConfidence: 0.8,
      text: "Edited", ocrConfidence: 0.8, color: "#123456", fontSize: 20,
      fontWeight: 700, fontCategory: "display" as const,
      x: 10, y: 20, width: 120, height: 30, visible: true
    };
    expect(await renderAutoLayerAsset(layer)).toBe(current);
    expect(renderAutoLayerTextAsset).toHaveBeenCalledWith(expect.objectContaining({
      text: "Edited", color: "#123456", fontWeight: 700, fontCategory: "display"
    }));
  });
});
