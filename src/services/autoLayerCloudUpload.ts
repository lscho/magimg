import { invoke } from "@tauri-apps/api/core";
import { isDesktopRuntime } from "@/services/imageCompression";

export const AUTO_LAYER_UPLOAD_COMPRESSION_THRESHOLD_BYTES = 2 * 1024 * 1024;
export const AUTO_LAYER_UPLOAD_DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export interface PreparedAutoLayerCloudUpload {
  blob: Blob;
  compressed: boolean;
  originalBytes: number;
  uploadBytes: number;
}

function responseBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new Error("自动分层上传压缩返回了无效数据。");
}

function responseBuffer(value: unknown): ArrayBuffer {
  const bytes = responseBytes(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function normalizedMaxBytes(value?: number) {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : AUTO_LAYER_UPLOAD_DEFAULT_MAX_BYTES;
}

export function shouldCompressAutoLayerUpload(sourceBytes: number, maxBytes?: number) {
  const limit = normalizedMaxBytes(maxBytes);
  const threshold = Math.min(
    AUTO_LAYER_UPLOAD_COMPRESSION_THRESHOLD_BYTES,
    Math.max(1, Math.floor(limit * 0.75))
  );
  return sourceBytes >= threshold;
}

export function chooseAutoLayerUploadBlob(
  source: Blob,
  compressed: Blob | null,
  maxBytes?: number
): PreparedAutoLayerCloudUpload {
  const limit = normalizedMaxBytes(maxBytes);
  const useCompressed = Boolean(compressed && compressed.size < source.size);
  const blob = useCompressed ? compressed! : source;
  if (blob.size > limit) {
    throw new Error(`整页背景压缩后仍超过 ${Math.ceil(limit / 1024 / 1024)} MiB 上传限制，请缩小原图后重试。`);
  }
  return {
    blob,
    compressed: useCompressed,
    originalBytes: source.size,
    uploadBytes: blob.size
  };
}

export async function prepareAutoLayerCloudUpload(
  source: Blob,
  maxBytes?: number
): Promise<PreparedAutoLayerCloudUpload> {
  if (!isDesktopRuntime() || !shouldCompressAutoLayerUpload(source.size, maxBytes)) {
    return chooseAutoLayerUploadBlob(source, null, maxBytes);
  }

  try {
    const input = new Uint8Array(await source.arrayBuffer());
    const response = await invoke<ArrayBuffer>("compression_auto_layer_upload", input, {
      headers: { "x-image-mime-type": source.type || "image/png" }
    });
    return chooseAutoLayerUploadBlob(
      source,
      new Blob([responseBuffer(response)], { type: "image/webp" }),
      maxBytes
    );
  } catch (error) {
    if (source.size <= normalizedMaxBytes(maxBytes)) {
      return chooseAutoLayerUploadBlob(source, null, maxBytes);
    }
    throw error instanceof Error
      ? error
      : new Error("整页背景压缩失败，请缩小原图后重试。");
  }
}

export function autoLayerUploadFileName(blob: Blob) {
  if (blob.type === "image/jpeg") return "auto-layer-background.jpg";
  if (blob.type === "image/webp") return "auto-layer-background.webp";
  return "auto-layer-background.png";
}
