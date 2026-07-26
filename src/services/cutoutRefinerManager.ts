import { appDataDir, join } from "@tauri-apps/api/path";
import {
  create,
  exists,
  mkdir,
  open,
  readFile,
  remove,
  stat,
  writeFile,
  type FileHandle
} from "@tauri-apps/plugin-fs";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { fetchHttp } from "@/services/desktop";
import type { ModelDownloadProgress } from "@/services/cutoutModelManager";
import type {
  CutoutModelStatus,
  CutoutRefinerDescriptor
} from "@/types";

const MODEL_REVISION = "6bc1297f6140f055a227b6d2cfe8c093281f35d2";
const MODEL_REPOSITORY =
  `https://huggingface.co/Xenova/vitmatte-small-composition-1k/resolve/${MODEL_REVISION}`;
const MODELS_DIR_NAME = "models";
const MANIFEST_FILENAME = "cutout-refiner-manifest.json";
const MANIFEST_VERSION = 1;
const READ_CHUNK_BYTES = 512 * 1024;

export const CUTOUT_REFINER: CutoutRefinerDescriptor = {
  id: "vitmatte-small-composition-1k",
  name: "ViTMatte Small",
  url: `${MODEL_REPOSITORY}/onnx/model.onnx`,
  fileName: "cutout-refiner-vitmatte-small.onnx",
  sizeBytes: 103_885_865,
  sha256: "bf28d2e0be2c073286e88d60ad649d7123da2749a2d99133fd1098d5887e0225",
  description: "精修透明边缘，并保护主体内部细节。"
};

interface InstalledRefinerRecord {
  id: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  installedAt: string;
}

interface RefinerManifest {
  version: number;
  installed: InstalledRefinerRecord | null;
}

const isTauri = "__TAURI_INTERNALS__" in window;
let cachedModelsDir: string | null = null;

function emptyManifest(): RefinerManifest {
  return { version: MANIFEST_VERSION, installed: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function resolveModelsDir(): Promise<string | null> {
  if (!isTauri) return null;
  if (cachedModelsDir) return cachedModelsDir;
  cachedModelsDir = await join(await appDataDir(), MODELS_DIR_NAME);
  return cachedModelsDir;
}

async function manifestPath(modelsDir: string) {
  return join(modelsDir, MANIFEST_FILENAME);
}

async function modelPath(descriptor: CutoutRefinerDescriptor, modelsDir: string) {
  return join(modelsDir, descriptor.fileName);
}

async function readManifest(modelsDir: string): Promise<RefinerManifest> {
  try {
    const path = await manifestPath(modelsDir);
    if (!(await exists(path))) return emptyManifest();
    const parsed = JSON.parse(new TextDecoder().decode(await readFile(path))) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.version !== MANIFEST_VERSION ||
      (parsed.installed !== null && !isRecord(parsed.installed))
    ) {
      return emptyManifest();
    }
    return parsed as unknown as RefinerManifest;
  } catch {
    return emptyManifest();
  }
}

async function writeManifest(modelsDir: string, manifest: RefinerManifest): Promise<void> {
  await mkdir(modelsDir, { recursive: true });
  await writeFile(
    await manifestPath(modelsDir),
    new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  );
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await handle.write(bytes.subarray(offset));
    if (written <= 0) throw new Error("精修模型文件写入中断。");
    offset += written;
  }
}

async function downloadFile(
  descriptor: CutoutRefinerDescriptor,
  path: string,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
) {
  let response: Response;
  try {
    response = await fetchHttp(descriptor.url, { signal });
  } catch (exception) {
    if (signal?.aborted) throw new DOMException("精修模型下载已取消。", "AbortError");
    throw new Error("精修模型下载失败：无法连接下载源，请检查网络后重试。", {
      cause: exception
    });
  }
  if (!response.ok || !response.body) {
    throw new Error(`精修模型下载失败：下载源返回 HTTP ${response.status}。`);
  }

  const reader = response.body.getReader();
  let output: FileHandle | null = null;
  let receivedBytes = 0;
  try {
    output = await create(path);
    for (;;) {
      if (signal?.aborted) throw new DOMException("精修模型下载已取消。", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      await writeAll(output, value);
      receivedBytes += value.byteLength;
      if (receivedBytes > descriptor.sizeBytes) {
        throw new Error("精修模型大小异常，请重新下载。");
      }
      onProgress?.({
        stage: "downloading",
        receivedBytes,
        totalBytes: descriptor.sizeBytes
      });
    }
  } finally {
    await output?.close().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
  }

  if (receivedBytes !== descriptor.sizeBytes) {
    throw new Error(
      `精修模型不完整（预期 ${descriptor.sizeBytes} 字节，实际 ${receivedBytes} 字节）。`
    );
  }
}

async function verifyFile(
  descriptor: CutoutRefinerDescriptor,
  path: string,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
) {
  let input: FileHandle | null = null;
  let verifiedBytes = 0;
  const digest = sha256.create();
  try {
    input = await open(path, { read: true });
    const buffer = new Uint8Array(READ_CHUNK_BYTES);
    for (;;) {
      if (signal?.aborted) throw new DOMException("精修模型校验已取消。", "AbortError");
      const bytesRead = await input.read(buffer);
      if (bytesRead === null) break;
      if (bytesRead <= 0) continue;
      digest.update(buffer.subarray(0, bytesRead));
      verifiedBytes += bytesRead;
      onProgress?.({
        stage: "verifying",
        receivedBytes: Math.min(verifiedBytes, descriptor.sizeBytes),
        totalBytes: descriptor.sizeBytes
      });
    }
  } finally {
    await input?.close().catch(() => undefined);
  }

  if (
    verifiedBytes !== descriptor.sizeBytes ||
    bytesToHex(digest.digest()) !== descriptor.sha256
  ) {
    throw new Error("精修模型校验失败，下载内容已损坏，请重试。");
  }
}

export async function getRefinerStatus(
  descriptor = CUTOUT_REFINER
): Promise<CutoutModelStatus> {
  const modelsDir = await resolveModelsDir();
  if (!modelsDir) return "missing";
  try {
    const [manifest, path] = await Promise.all([
      readManifest(modelsDir),
      modelPath(descriptor, modelsDir)
    ]);
    const record = manifest.installed;
    if (
      !record ||
      record.id !== descriptor.id ||
      record.fileName !== descriptor.fileName ||
      record.sizeBytes !== descriptor.sizeBytes ||
      record.sha256 !== descriptor.sha256 ||
      !(await exists(path))
    ) {
      return "missing";
    }
    const metadata = await stat(path);
    return metadata.isFile && metadata.size === descriptor.sizeBytes ? "ready" : "missing";
  } catch {
    return "error";
  }
}

export async function downloadRefiner(
  descriptor = CUTOUT_REFINER,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!isTauri) {
    throw new Error("浏览器预览不能安装精修模型，请在桌面客户端中使用。");
  }
  const modelsDir = await resolveModelsDir();
  if (!modelsDir) throw new Error("无法获取应用数据目录。");
  await mkdir(modelsDir, { recursive: true });
  const path = await modelPath(descriptor, modelsDir);
  await remove(path).catch(() => undefined);
  await writeManifest(modelsDir, emptyManifest());

  try {
    onProgress?.({ stage: "downloading", receivedBytes: 0, totalBytes: descriptor.sizeBytes });
    await downloadFile(descriptor, path, onProgress, signal);
    onProgress?.({ stage: "verifying", receivedBytes: 0, totalBytes: descriptor.sizeBytes });
    await verifyFile(descriptor, path, onProgress, signal);
    onProgress?.({
      stage: "installing",
      receivedBytes: descriptor.sizeBytes,
      totalBytes: descriptor.sizeBytes
    });
    await writeManifest(modelsDir, {
      version: MANIFEST_VERSION,
      installed: {
        id: descriptor.id,
        fileName: descriptor.fileName,
        sizeBytes: descriptor.sizeBytes,
        sha256: descriptor.sha256,
        installedAt: new Date().toISOString()
      }
    });
  } catch (exception) {
    await remove(path).catch(() => undefined);
    throw exception;
  }
}

export async function removeRefiner(
  descriptor = CUTOUT_REFINER
): Promise<void> {
  const modelsDir = await resolveModelsDir();
  if (!modelsDir) return;
  await remove(await modelPath(descriptor, modelsDir)).catch(() => undefined);
  await writeManifest(modelsDir, emptyManifest());
}
