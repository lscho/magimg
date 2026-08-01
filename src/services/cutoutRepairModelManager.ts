import { appDataDir, join } from "@tauri-apps/api/path";
import {
  create,
  exists,
  mkdir,
  readFile,
  remove,
  stat,
  writeFile,
  type FileHandle
} from "@tauri-apps/plugin-fs";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { CUTOUT_MODEL_DOWNLOAD_BASE_URL } from "@/constants/cutoutModels";
import { fetchHttp } from "@/services/desktop";
import type { ModelDownloadProgress } from "@/services/cutoutModelManager";
import type {
  CutoutModelStatus,
  CutoutRepairDescriptor
} from "@/types";

const MODELS_DIR_NAME = "models";
const MANIFEST_FILENAME = "cutout-repair-manifest.json";
const MANIFEST_VERSION = 1;

export const CUTOUT_REPAIR_MODEL: CutoutRepairDescriptor = {
  id: "big-lama-fp32-512",
  name: "Big-LaMa",
  url: `${CUTOUT_MODEL_DOWNLOAD_BASE_URL}/lama_fp32.onnx`,
  fileName: "cutout-repair-big-lama-fp32.onnx",
  sizeBytes: 208_044_816,
  sha256: "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6",
  inputWidth: 512,
  inputHeight: 512,
  description: "在本地补全被人物、文字或图标遮挡的背景。"
};

interface RepairManifest {
  version: 1;
  installed: {
    id: string;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    installedAt: string;
  } | null;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function emptyManifest(): RepairManifest {
  return { version: MANIFEST_VERSION, installed: null };
}

async function modelsDir() {
  return join(await appDataDir(), MODELS_DIR_NAME);
}

async function manifestPath(directory: string) {
  return join(directory, MANIFEST_FILENAME);
}

async function modelPath(directory: string) {
  return join(directory, CUTOUT_REPAIR_MODEL.fileName);
}

async function readManifest(directory: string): Promise<RepairManifest> {
  try {
    const path = await manifestPath(directory);
    if (!(await exists(path))) return emptyManifest();
    const value = JSON.parse(new TextDecoder().decode(await readFile(path))) as RepairManifest;
    return value.version === MANIFEST_VERSION ? value : emptyManifest();
  } catch {
    return emptyManifest();
  }
}

async function writeManifest(directory: string, manifest: RepairManifest) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    await manifestPath(directory),
    new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  );
}

async function writeAll(handle: FileHandle, bytes: Uint8Array) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await handle.write(bytes.subarray(offset));
    if (written <= 0) throw new Error("背景修复模型写入中断。");
    offset += written;
  }
}

export async function getRepairModelStatus(): Promise<CutoutModelStatus> {
  if (!isTauri) return "missing";
  try {
    const directory = await modelsDir();
    const record = (await readManifest(directory)).installed;
    if (!record || record.id !== CUTOUT_REPAIR_MODEL.id ||
      record.fileName !== CUTOUT_REPAIR_MODEL.fileName ||
      record.sizeBytes !== CUTOUT_REPAIR_MODEL.sizeBytes ||
      record.sha256 !== CUTOUT_REPAIR_MODEL.sha256) return "missing";
    const path = await modelPath(directory);
    if (!(await exists(path))) return "missing";
    return (await stat(path)).size === CUTOUT_REPAIR_MODEL.sizeBytes ? "ready" : "missing";
  } catch {
    return "error";
  }
}

export async function downloadRepairModel(
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
) {
  if (!isTauri) throw new Error("浏览器预览不能安装背景修复模型。");
  const directory = await modelsDir();
  await mkdir(directory, { recursive: true });
  const path = await modelPath(directory);
  let response: Response;
  try {
    response = await fetchHttp(CUTOUT_REPAIR_MODEL.url, { signal });
  } catch (exception) {
    if (signal?.aborted) throw new DOMException("模型下载已取消。", "AbortError");
    throw new Error("背景修复模型下载失败，请检查网络后重试。", { cause: exception });
  }
  if (!response.ok || !response.body) {
    throw new Error(`背景修复模型下载失败：HTTP ${response.status}。`);
  }

  const digest = sha256.create();
  const reader = response.body.getReader();
  let receivedBytes = 0;
  let handle: FileHandle | null = null;
  try {
    handle = await create(path);
    for (;;) {
      if (signal?.aborted) throw new DOMException("模型下载已取消。", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (receivedBytes + value.byteLength > CUTOUT_REPAIR_MODEL.sizeBytes) {
        throw new Error("背景修复模型大小异常，请重新下载。");
      }
      await writeAll(handle, value);
      digest.update(value);
      receivedBytes += value.byteLength;
      onProgress?.({
        stage: "downloading",
        receivedBytes,
        totalBytes: CUTOUT_REPAIR_MODEL.sizeBytes
      });
    }
    await handle.close();
    handle = null;
    if (receivedBytes !== CUTOUT_REPAIR_MODEL.sizeBytes) {
      throw new Error("背景修复模型下载不完整，请重新下载。");
    }
    onProgress?.({
      stage: "verifying",
      receivedBytes,
      totalBytes: CUTOUT_REPAIR_MODEL.sizeBytes
    });
    if (bytesToHex(digest.digest()) !== CUTOUT_REPAIR_MODEL.sha256) {
      throw new Error("背景修复模型校验失败，请重新下载。");
    }
    onProgress?.({
      stage: "installing",
      receivedBytes,
      totalBytes: CUTOUT_REPAIR_MODEL.sizeBytes
    });
    await writeManifest(directory, {
      version: MANIFEST_VERSION,
      installed: {
        id: CUTOUT_REPAIR_MODEL.id,
        fileName: CUTOUT_REPAIR_MODEL.fileName,
        sizeBytes: CUTOUT_REPAIR_MODEL.sizeBytes,
        sha256: CUTOUT_REPAIR_MODEL.sha256,
        installedAt: new Date().toISOString()
      }
    });
  } catch (exception) {
    await handle?.close().catch(() => undefined);
    await remove(path).catch(() => undefined);
    throw exception;
  } finally {
    reader.releaseLock();
  }
}
