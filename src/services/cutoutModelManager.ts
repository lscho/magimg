import { appDataDir, join } from "@tauri-apps/api/path";
import {
  create,
  exists,
  mkdir,
  readFile,
  remove,
  writeFile,
  type FileHandle
} from "@tauri-apps/plugin-fs";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { CUTOUT_MODEL_DOWNLOAD_BASE_URL } from "@/constants/cutoutModels";
import { fetchHttp } from "@/services/desktop";
import type {
  CutoutModelDescriptor,
  CutoutModelFileDescriptor,
  CutoutModelStatus
} from "@/types";

const MODELS_DIR_NAME = "models";
const MANIFEST_FILENAME = "model-manifest.json";
const MANIFEST_VERSION = 3;

/** 历史版本遗留的模型文件，安装时顺带清理。 */
const OBSOLETE_MODEL_FILE_NAMES = [
  "prompt_encoder_mask_decoder_quantized.onnx",
  "prompt_encoder_mask_decoder_quantized.onnx_data"
] as const;

const MODEL_FILES = [
  {
    fileName: "vision_encoder_quantized.onnx",
    url: `${CUTOUT_MODEL_DOWNLOAD_BASE_URL}/vision_encoder_quantized.onnx`,
    sizeBytes: 861_193,
    sha256: "dadc94ee17c53bd55d98d15836cdd7d9d7eb80162d4b8bbcbd10e1a5dfeff50e"
  },
  {
    fileName: "vision_encoder_quantized.onnx_data",
    url: `${CUTOUT_MODEL_DOWNLOAD_BASE_URL}/vision_encoder_quantized.onnx_data`,
    sizeBytes: 98_862_416,
    sha256: "ecef22cbdb519a7e153b7e4ddec37e64404229d38f5190bf76db20775c003a79"
  },
  {
    fileName: "prompt_encoder_mask_decoder.onnx",
    url: `${CUTOUT_MODEL_DOWNLOAD_BASE_URL}/prompt_encoder_mask_decoder.onnx`,
    sizeBytes: 213_114,
    sha256: "f39eeec20243ed1c8f2cd013812e77813d937ddbc800fa4bc703761adc7e63cd"
  },
  {
    fileName: "prompt_encoder_mask_decoder.onnx_data",
    url: `${CUTOUT_MODEL_DOWNLOAD_BASE_URL}/prompt_encoder_mask_decoder.onnx_data`,
    sizeBytes: 20_958_208,
    sha256: "445cd3f72a218815db10e336f4f1c46a6eb2713a0160a85af5365134607f32a7"
  }
] as const satisfies readonly CutoutModelFileDescriptor[];

/**
 * BiRefNet Swin-T 通用抠图模型（rembg 官方导出，MIT）。
 * 输入 1x3x1024x1024 NCHW 归一化 float，输出 1x1x1024x1024 logits。
 * 下载源为 rembg 官方 GitHub Release（固定 URL + SHA-256 校验）。
 */
const BIRENET_MODEL_FILE = {
  fileName: "birefnet-swin-tiny-general.onnx",
  url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx",
  sizeBytes: 224_005_088,
  sha256: "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333"
} as const satisfies CutoutModelFileDescriptor;

/**
 * 当前资源包固定使用 SAM 2.1 Hiera Base+：encoder 用动态量化版控制体积，
 * decoder 用全精度版保证掩码边缘质量（仅多约 12MB）。SAM 3.1 官方权重仍
 * 不兼容本客户端的原生 ONNX 契约，因此不作为可运行档位。
 */
export const CUTOUT_MODEL: CutoutModelDescriptor = {
  id: "sam2.1-hiera-base-plus-quantized",
  name: "SAM 2.1 Hiera Base+",
  files: MODEL_FILES,
  sizeBytes: MODEL_FILES.reduce((total, file) => total + file.sizeBytes, 0),
  inputWidth: 1024,
  inputHeight: 1024,
  maskWidth: 256,
  maskHeight: 256,
  recommended: true,
  description: "提升复杂主体、遮挡区域与内部结构的分割完整性。"
};

/**
 * BiRefNet Swin-T 通用分割模型（/cutout 链路的分割档位，替代 SAM encoder+decoder）。
 * 输入 1x3x1024x1024 NCHW 归一化 float，输出 1x1x1024x1024 logits。
 * 保留 /auto-layer 使用的 SAM 模型（CUTOUT_MODEL）不变。
 */
export const BIRENET_MODEL: CutoutModelDescriptor = {
  id: "birefnet-swin-tiny-general",
  name: "BiRefNet Swin-T",
  files: [BIRENET_MODEL_FILE],
  sizeBytes: BIRENET_MODEL_FILE.sizeBytes,
  inputWidth: 1024,
  inputHeight: 1024,
  maskWidth: 1024,
  maskHeight: 1024,
  recommended: true,
  description: "高分辨率前景/背景分割，保留边缘细节。"
};

export const CUTOUT_MODELS: readonly CutoutModelDescriptor[] = [
  CUTOUT_MODEL,
  BIRENET_MODEL
];

export type ModelInstallStage = "downloading" | "verifying" | "installing";

export interface ModelDownloadProgress {
  stage: ModelInstallStage;
  receivedBytes: number;
  totalBytes: number;
}

interface InstalledModelRecord {
  id: string;
  sizeBytes: number;
  fileNames: string[];
  installedAt: string;
}

interface ModelManifest {
  version: number;
  installed: Record<string, InstalledModelRecord>;
}

interface DownloadedModelFile {
  descriptor: CutoutModelFileDescriptor;
  sha256: string;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
let cachedModelsDir: string | null = null;

function emptyManifest(): ModelManifest {
  return { version: MANIFEST_VERSION, installed: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function supportsLocalCutoutModels(): boolean {
  return isTauri;
}

async function resolveModelsDir(): Promise<string | null> {
  if (!isTauri) return null;
  if (cachedModelsDir) return cachedModelsDir;
  cachedModelsDir = await join(await appDataDir(), MODELS_DIR_NAME);
  return cachedModelsDir;
}

async function modelLocalPath(modelsDir: string, fileName: string) {
  return join(modelsDir, fileName);
}

async function manifestPath(modelsDir: string) {
  return join(modelsDir, MANIFEST_FILENAME);
}

async function readManifest(modelsDir: string): Promise<ModelManifest> {
  if (!isTauri) return emptyManifest();
  try {
    const path = await manifestPath(modelsDir);
    if (!(await exists(path))) return emptyManifest();
    const parsed = JSON.parse(new TextDecoder().decode(await readFile(path))) as unknown;
    if (
      !isRecord(parsed) ||
      parsed.version !== MANIFEST_VERSION ||
      !isRecord(parsed.installed)
    ) {
      return emptyManifest();
    }
    return {
      version: MANIFEST_VERSION,
      installed: parsed.installed as Record<string, InstalledModelRecord>
    };
  } catch {
    return emptyManifest();
  }
}

async function writeManifest(modelsDir: string, manifest: ModelManifest): Promise<void> {
  await mkdir(modelsDir, { recursive: true });
  await writeFile(
    await manifestPath(modelsDir),
    new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  );
}

function expectedFileNames(descriptor: CutoutModelDescriptor) {
  return descriptor.files.map((file) => file.fileName);
}

function hasExpectedFiles(record: InstalledModelRecord, descriptor: CutoutModelDescriptor) {
  const expected = expectedFileNames(descriptor);
  return record.id === descriptor.id &&
    record.sizeBytes === descriptor.sizeBytes &&
    record.fileNames.length === expected.length &&
    record.fileNames.every((fileName, index) => fileName === expected[index]);
}

export function findModelDescriptor(modelId: string): CutoutModelDescriptor | undefined {
  return CUTOUT_MODELS.find((model) => model.id === modelId);
}

export async function getModelStatus(
  descriptor: CutoutModelDescriptor
): Promise<CutoutModelStatus> {
  const modelsDir = await resolveModelsDir();
  if (!modelsDir) return "missing";

  try {
    const manifest = await readManifest(modelsDir);
    const record = manifest.installed[descriptor.id];
    if (!record || !hasExpectedFiles(record, descriptor)) return "missing";
    const filePaths = await Promise.all(
      descriptor.files.map((file) => modelLocalPath(modelsDir, file.fileName))
    );
    const fileStatuses = await Promise.all(filePaths.map((path) => exists(path)));
    return fileStatuses.every(Boolean) ? "ready" : "missing";
  } catch {
    return "error";
  }
}

export async function getModelStatuses(): Promise<Record<string, CutoutModelStatus>> {
  const entries = await Promise.all(
    CUTOUT_MODELS.map(async (model) => [model.id, await getModelStatus(model)] as const)
  );
  return Object.fromEntries(entries);
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await handle.write(bytes.subarray(offset));
    if (written <= 0) throw new Error("本地模型文件写入中断。");
    offset += written;
  }
}

async function downloadModelFile(
  file: CutoutModelFileDescriptor,
  outputPath: string,
  completedBytes: number,
  totalBytes: number,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
): Promise<DownloadedModelFile> {
  let response: Response;
  try {
    response = await fetchHttp(file.url, { signal });
  } catch (exception) {
    if (signal?.aborted) throw new DOMException("模型下载已取消。", "AbortError");
    throw new Error("模型下载失败：无法连接下载源，请检查网络后重试。", {
      cause: exception
    });
  }
  if (!response.ok || !response.body) {
    throw new Error(`模型下载失败：下载源返回 HTTP ${response.status}。`);
  }

  const reader = response.body.getReader();
  const digest = sha256.create();
  let output: FileHandle | null = null;
  let receivedBytes = 0;
  try {
    output = await create(outputPath);
    for (;;) {
      if (signal?.aborted) throw new DOMException("模型下载已取消。", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (value.byteLength > file.sizeBytes - receivedBytes) {
        throw new Error(`模型文件 ${file.fileName} 大小异常，请重新下载。`);
      }
      await writeAll(output, value);
      digest.update(value);
      receivedBytes += value.byteLength;
      onProgress?.({
        stage: "downloading",
        receivedBytes: completedBytes + receivedBytes,
        totalBytes
      });
    }
  } finally {
    await output?.close().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
  }

  if (receivedBytes !== file.sizeBytes) {
    throw new Error(
      `模型文件 ${file.fileName} 不完整（预期 ${file.sizeBytes} 字节，实际 ${receivedBytes} 字节）。`
    );
  }
  return { descriptor: file, sha256: bytesToHex(digest.digest()) };
}

function verifyDownloadedFiles(
  downloaded: DownloadedModelFile[],
  totalBytes: number,
  onProgress?: (progress: ModelDownloadProgress) => void
) {
  let verifiedBytes = 0;
  onProgress?.({ stage: "verifying", receivedBytes: 0, totalBytes });
  for (const file of downloaded) {
    if (file.sha256 !== file.descriptor.sha256) {
      throw new Error(`模型文件 ${file.descriptor.fileName} 校验失败，请重新下载。`);
    }
    verifiedBytes += file.descriptor.sizeBytes;
    onProgress?.({ stage: "verifying", receivedBytes: verifiedBytes, totalBytes });
  }
}

/** 流式下载并逐文件校验 SAM 2.1 ONNX 与 external-data。 */
export async function downloadModel(
  descriptor: CutoutModelDescriptor,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!isTauri) {
    throw new Error("浏览器预览不能安装本地模型，请在桌面客户端中使用。");
  }
  const modelsDir = await resolveModelsDir();
  if (!modelsDir) throw new Error("无法获取应用数据目录。");
  await mkdir(modelsDir, { recursive: true });

  const filePaths = await Promise.all(
    descriptor.files.map((file) => modelLocalPath(modelsDir, file.fileName))
  );
  await Promise.all(filePaths.map((path) => remove(path).catch(() => undefined)));
  await Promise.all(
    OBSOLETE_MODEL_FILE_NAMES.map(async (fileName) =>
      remove(await modelLocalPath(modelsDir, fileName)).catch(() => undefined)
    )
  );

  try {
    const downloaded: DownloadedModelFile[] = [];
    let completedBytes = 0;
    onProgress?.({
      stage: "downloading",
      receivedBytes: 0,
      totalBytes: descriptor.sizeBytes
    });
    for (let index = 0; index < descriptor.files.length; index += 1) {
      const file = descriptor.files[index];
      downloaded.push(await downloadModelFile(
        file,
        filePaths[index],
        completedBytes,
        descriptor.sizeBytes,
        onProgress,
        signal
      ));
      completedBytes += file.sizeBytes;
    }
    verifyDownloadedFiles(downloaded, descriptor.sizeBytes, onProgress);

    onProgress?.({
      stage: "installing",
      receivedBytes: 0,
      totalBytes: descriptor.sizeBytes
    });
    const manifest = await readManifest(modelsDir);
    manifest.installed[descriptor.id] = {
      id: descriptor.id,
      sizeBytes: descriptor.sizeBytes,
      fileNames: expectedFileNames(descriptor),
      installedAt: new Date().toISOString()
    };
    await writeManifest(modelsDir, manifest);
    onProgress?.({
      stage: "installing",
      receivedBytes: descriptor.sizeBytes,
      totalBytes: descriptor.sizeBytes
    });
  } catch (exception) {
    await Promise.all(filePaths.map((path) => remove(path).catch(() => undefined)));
    throw exception;
  }
}

export async function removeModel(descriptor: CutoutModelDescriptor): Promise<void> {
  if (!isTauri) return;
  const modelsDir = await resolveModelsDir();
  if (!modelsDir) return;
  const filePaths = await Promise.all(
    descriptor.files.map((file) => modelLocalPath(modelsDir, file.fileName))
  );
  await Promise.all(filePaths.map((path) => remove(path).catch(() => undefined)));
  const manifest = await readManifest(modelsDir);
  delete manifest.installed[descriptor.id];
  await writeManifest(modelsDir, manifest);
}
