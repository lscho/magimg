import { describe, expect, it } from "vitest";
import {
  AUTO_LAYER_UPLOAD_COMPRESSION_THRESHOLD_BYTES,
  autoLayerUploadFileName,
  chooseAutoLayerUploadBlob,
  shouldCompressAutoLayerUpload
} from "@/services/autoLayerCloudUpload";

describe("auto layer cloud upload", () => {
  it("only schedules compression for transfer copies large enough to benefit", () => {
    expect(shouldCompressAutoLayerUpload(AUTO_LAYER_UPLOAD_COMPRESSION_THRESHOLD_BYTES - 1)).toBe(false);
    expect(shouldCompressAutoLayerUpload(AUTO_LAYER_UPLOAD_COMPRESSION_THRESHOLD_BYTES)).toBe(true);
    expect(shouldCompressAutoLayerUpload(750_000, 1_000_000)).toBe(true);
  });

  it("uses a smaller WebP candidate and keeps a no-benefit original", () => {
    const source = new Blob([new Uint8Array(100)], { type: "image/png" });
    const smaller = new Blob([new Uint8Array(60)], { type: "image/webp" });
    const larger = new Blob([new Uint8Array(120)], { type: "image/webp" });

    expect(chooseAutoLayerUploadBlob(source, smaller, 200)).toMatchObject({
      blob: smaller,
      compressed: true,
      originalBytes: 100,
      uploadBytes: 60
    });
    expect(chooseAutoLayerUploadBlob(source, larger, 200)).toMatchObject({
      blob: source,
      compressed: false,
      uploadBytes: 100
    });
  });

  it("rejects the upload before the request when every candidate exceeds the server limit", () => {
    const source = new Blob([new Uint8Array(100)], { type: "image/png" });
    const compressed = new Blob([new Uint8Array(80)], { type: "image/webp" });
    expect(() => chooseAutoLayerUploadBlob(source, compressed, 70)).toThrow("压缩后仍超过");
  });

  it("uses a filename consistent with the selected transfer MIME type", () => {
    expect(autoLayerUploadFileName(new Blob([], { type: "image/webp" }))).toBe("auto-layer-background.webp");
    expect(autoLayerUploadFileName(new Blob([], { type: "image/jpeg" }))).toBe("auto-layer-background.jpg");
  });
});
