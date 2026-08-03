import { appDataDir, join } from "@tauri-apps/api/path";
import { create, exists, mkdir, readFile, readTextFile, remove, stat, writeFile, type FileHandle } from "@tauri-apps/plugin-fs";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { CUTOUT_MODEL_DOWNLOAD_BASE_URL } from "@/constants/cutoutModels";
import { fetchHttp } from "@/services/desktop";
import type { CutoutModelStatus } from "@/types";
import type { ModelDownloadProgress } from "@/services/cutoutModelManager";

const MANIFEST = "auto-layer-recognition-manifest.json";
const VERSION = 1;
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function resolveAutoLayerRecognitionResourceUrl(
  fileName: string
) {
  return `${CUTOUT_MODEL_DOWNLOAD_BASE_URL}/${fileName}`;
}

const files = [
  {
    fileName: "auto-layer-ocr-det.onnx",
    url: resolveAutoLayerRecognitionResourceUrl("auto-layer-ocr-det.onnx"),
    sizeBytes: 4_826_518,
    sha256: "a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d"
  },
  {
    fileName: "auto-layer-ocr-rec.onnx",
    url: resolveAutoLayerRecognitionResourceUrl("auto-layer-ocr-rec.onnx"),
    sizeBytes: 16_534_782,
    sha256: "da72dc72ca4dc220df0dfde68c1dedc31c58d3e76a25871122e5056227d50092"
  },
  {
    fileName: "auto-layer-siglip2-vision-int8.onnx",
    url: resolveAutoLayerRecognitionResourceUrl("auto-layer-siglip2-vision-int8.onnx"),
    sizeBytes: 94_553_333,
    sha256: "5f2b401c1a4fc095702a5d45348e17ad46c4f87064085365b43c6e8eaa5c0070"
  }
] as const;

const dictionary = {
  fileName: "auto-layer-ocr-inference.yml",
  url: resolveAutoLayerRecognitionResourceUrl("auto-layer-ocr-inference.yml")
} as const;

const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);

async function modelsDir() {
  return join(await appDataDir(), "models");
}

async function writeAll(handle: FileHandle, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await handle.write(bytes.subarray(offset));
    if (written <= 0) throw new Error("识别资源写入中断。");
    offset += written;
  }
}

async function downloadPinned(
  file: typeof files[number],
  path: string,
  completed: number,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
) {
  const response = await fetchHttp(file.url, { signal });
  if (!response.ok || !response.body) throw new Error(`识别资源下载失败（HTTP ${response.status}）。`);
  const reader = response.body.getReader();
  const digest = sha256.create();
  const handle = await create(path);
  let received = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("识别资源下载已取消。", "AbortError");
      const chunk = await reader.read();
      if (chunk.done) break;
      if (!chunk.value?.length) continue;
      received += chunk.value.length;
      if (received > file.sizeBytes) throw new Error(`${file.fileName} 大小异常。`);
      digest.update(chunk.value);
      await writeAll(handle, chunk.value);
      onProgress?.({ stage: "downloading", receivedBytes: completed + received, totalBytes });
    }
  } finally {
    await handle.close().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
  }
  if (received !== file.sizeBytes || bytesToHex(digest.digest()) !== file.sha256) {
    await remove(path).catch(() => undefined);
    throw new Error(`${file.fileName} 完整性校验失败。`);
  }
}

export async function getAutoLayerRecognitionStatus(): Promise<CutoutModelStatus> {
  if (!isTauri) return "missing";
  try {
    const directory = await modelsDir();
    const manifestPath = await join(directory, MANIFEST);
    if (!await exists(manifestPath)) return "missing";
    const manifest = JSON.parse(await readTextFile(manifestPath)) as {
      version?: number;
      files?: Array<{ fileName?: string; sizeBytes?: number; sha256?: string }>;
      dictionary?: { fileName?: string; sizeBytes?: number; sha256?: string };
    };
    if (manifest.version !== VERSION) return "missing";
    for (const file of files) {
      const record = manifest.files?.find(item => item.fileName === file.fileName);
      const path = await join(directory, file.fileName);
      if (!record || record.sizeBytes !== file.sizeBytes || record.sha256 !== file.sha256
        || !await exists(path) || (await stat(path)).size !== file.sizeBytes) return "missing";
    }
    const dictionaryRecord = manifest.dictionary;
    const dictionaryPath = await join(directory, dictionary.fileName);
    if (!dictionaryRecord || dictionaryRecord.fileName !== dictionary.fileName || !await exists(dictionaryPath)
      || (await stat(dictionaryPath)).size !== dictionaryRecord.sizeBytes) return "missing";
    const dictionaryBytes = await readFile(dictionaryPath);
    return bytesToHex(sha256(dictionaryBytes)) === dictionaryRecord.sha256 ? "ready" : "missing";
  } catch {
    return "error";
  }
}

export async function downloadAutoLayerRecognitionResources(
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
) {
  if (!isTauri) throw new Error("浏览器预览不能安装自动分层识别资源。");
  const directory = await modelsDir();
  await mkdir(directory, { recursive: true });
  let completed = 0;
  for (const file of files) {
    const path = await join(directory, file.fileName);
    await remove(path).catch(() => undefined);
    await downloadPinned(file, path, completed, onProgress, signal);
    completed += file.sizeBytes;
  }
  const dictionaryResponse = await fetchHttp(dictionary.url, { signal });
  if (!dictionaryResponse.ok) throw new Error("OCR 字符表下载失败。");
  const dictionaryBytes = new Uint8Array(await dictionaryResponse.arrayBuffer());
  if (!dictionaryBytes.length) throw new Error("OCR 字符表为空。");
  await writeFile(await join(directory, dictionary.fileName), dictionaryBytes);
  onProgress?.({ stage: "verifying", receivedBytes: totalBytes, totalBytes });
  await writeFile(await join(directory, MANIFEST), new TextEncoder().encode(JSON.stringify({
    version: VERSION,
    installedAt: new Date().toISOString(),
    files: files.map(file => ({ fileName: file.fileName, sizeBytes: file.sizeBytes, sha256: file.sha256 })),
    dictionary: { fileName: dictionary.fileName, sizeBytes: dictionaryBytes.length, sha256: bytesToHex(sha256(dictionaryBytes)) }
  }, null, 2)));
  onProgress?.({ stage: "installing", receivedBytes: totalBytes, totalBytes });
}

export const AUTO_LAYER_RECOGNITION_SIZE = totalBytes;
