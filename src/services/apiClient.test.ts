import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchHttp = vi.hoisted(() => vi.fn());
vi.mock("@/services/desktop", () => ({ fetchHttp }));

import {
  apiClient,
  setAccessToken,
  setUnauthorizedHandler
} from "@/services/apiClient";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("background repair API contract", () => {
  beforeEach(() => {
    fetchHttp.mockReset();
    setAccessToken(null);
    setUnauthorizedHandler(null);
  });

  it("charges local and cloud matting with idempotency keys", async () => {
    fetchHttp.mockResolvedValue(jsonResponse({ mattingId: "m1", cost: 5, balance: 95 }));
    await apiClient.chargeMatting("cloud");
    const [url, options] = fetchHttp.mock.calls[0];
    expect(url).toBe("/api/client/v1/matting");
    expect(JSON.parse(options.body)).toEqual({ mode: "cloud" });
    expect(options.headers["Idempotency-Key"]).toMatch(/^huanhua:/u);
  });

  it("submits one multipart image and grayscale mask task", async () => {
    fetchHttp.mockResolvedValue(jsonResponse({
      id: "repair-1",
      status: "pending",
      cost: 10,
      balance: 90
    }));
    const image = new File([new Uint8Array([1])], "source.png", { type: "image/png" });
    const mask = new Blob([new Uint8Array([2])], { type: "image/png" });
    await apiClient.createBackgroundRepair({
      image,
      mask,
      mattingId: "matting-1",
      selectionBoxes: [{ id: "avatar", x: 10, y: 20, width: 80, height: 100 }]
    });
    const [url, options] = fetchHttp.mock.calls[0];
    expect(url).toBe("/api/client/v1/background-repairs");
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get("image")).toBeInstanceOf(File);
    expect(options.body.get("mask")).toBeInstanceOf(File);
    expect(options.body.get("mattingId")).toBe("matting-1");
    expect(JSON.parse(options.body.get("selectionBoxes"))).toEqual([
      { x: 10, y: 20, width: 80, height: 100 }
    ]);
    expect(options.headers["Content-Type"]).toBeUndefined();
    expect(options.headers["Idempotency-Key"]).toMatch(/^huanhua:/u);
  });

  it("reuses the server input asset when only the repair mask changed", async () => {
    fetchHttp.mockResolvedValue(jsonResponse({
      id: "repair-2",
      inputAssetId: "40",
      status: "pending",
      cost: 10,
      balance: 80
    }));
    const mask = new Blob([new Uint8Array([2])], { type: "image/png" });
    await apiClient.createBackgroundRepair({
      inputAssetId: "40",
      mask,
      mattingId: "matting-2",
      selectionBoxes: [{ id: "avatar", x: 10, y: 20, width: 80, height: 100 }]
    });
    const body = fetchHttp.mock.calls[0][1].body as FormData;
    expect(body.get("image")).toBeNull();
    expect(body.get("inputAssetId")).toBe("40");
    expect(body.get("mask")).toBeInstanceOf(File);
  });

  it("queries and cancels cloud tasks", async () => {
    fetchHttp
      .mockResolvedValueOnce(jsonResponse({ id: "r/1", status: "processing", cost: 10, balance: 90 }))
      .mockResolvedValueOnce(jsonResponse({ id: "r/1", status: "canceled", cost: 10, balance: 100 }));
    await apiClient.backgroundRepair("r/1");
    await apiClient.cancelBackgroundRepair("r/1");
    expect(fetchHttp.mock.calls[0][0]).toBe("/api/client/v1/background-repairs/r%2F1");
    expect(fetchHttp.mock.calls[1][0]).toBe("/api/client/v1/background-repairs/r%2F1/cancel");
    expect(fetchHttp.mock.calls[1][1].method).toBe("POST");
  });

  it("surfaces 409 and invokes unauthorized handling for 401", async () => {
    fetchHttp.mockResolvedValueOnce(jsonResponse({ message: "积分不足" }, 409));
    await expect(apiClient.chargeMatting("cloud")).rejects.toMatchObject({
      statusCode: 409,
      message: "积分不足"
    });

    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    fetchHttp.mockResolvedValueOnce(jsonResponse({}, 401));
    await expect(apiClient.backgroundRepair("repair-1")).rejects.toMatchObject({
      statusCode: 401
    });
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it("keeps optional cloud capability fields absent for older servers", async () => {
    fetchHttp.mockResolvedValue(jsonResponse({
      textToImageCost: 10,
      imageToImageCost: 15,
      mattingCost: 5,
      maxAttempts: 3,
      uploadMaxBytes: 1024,
      supportedMimeTypes: ["image/png"],
      supportedQualities: ["auto"],
      sizeRules: {
        edgeStep: 16,
        maxEdge: 1024,
        maxAspectRatio: 3,
        minPixels: 1,
        maxPixels: 1048576
      }
    }));
    const capabilities = await apiClient.capabilities();
    expect(capabilities.backgroundRepairEnabled).toBeUndefined();
  });
});
