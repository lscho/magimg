import { appDataDir, join } from "@tauri-apps/api/path";
import {
  create,
  exists,
  mkdir,
  open,
  readFile,
  remove,
  SeekMode,
  writeFile,
  type FileHandle
} from "@tauri-apps/plugin-fs";
import { Inflate } from "fflate";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { fetchHttp } from "@/services/desktop";
import type { CutoutModelDescriptor, CutoutModelStatus } from "@/types";

const MODEL_REVISION = "9effc01a9e135621d710d49159f1ffb0b6f724dc";
const MODEL_REPOSITORY =
  `https://huggingface.co/vietanhdev/segment-anything-onnx-models/resolve/${MODEL_REVISION}`;
const MODELS_DIR_NAME = "models";
const MANIFEST_FILENAME = "model-manifest.json";
const MANIFEST_VERSION = 2;
const ARCHIVE_READ_CHUNK_BYTES = 512 * 1024;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_EOCD_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const ZIP_CENTRAL_DIRECTORY_HEADER_BYTES = 46;
const ZIP_LOCAL_FILE_HEADER_BYTES = 30;
const ZIP_COMPRESSION_STORED = 0;
const ZIP_COMPRESSION_DEFLATE = 8;
const ZIP_ENCRYPTED_FLAG = 0x0001;

const CRC32_TABLE = new Uint32Array(256);
for (let value = 0; value < CRC32_TABLE.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  CRC32_TABLE[value] = crc >>> 0;
}

/**
 * 采用当前 Tauri/Rust 原生 ONNX Runtime 双模型契约的量化模型，从大到小排列。
 * SAM 3.1 是当前官方最新版本，但其官方权重需要 PyTorch/CUDA，暂无可直接用于
 * 本客户端双 ONNX（encoder + decoder）契约的官方运行包。
 */
export const CUTOUT_MODELS: readonly CutoutModelDescriptor[] = [
  {
    id: "sam-vit-h-quant",
    name: "SAM ViT-H",
    archiveFileName: "sam_vit_h_4b8939_quant.zip",
    encoderArchiveEntry: "sam_vit_h_4b8939.encoder.quant.onnx",
    decoderArchiveEntry: "sam_vit_h_4b8939.decoder.quant.onnx",
    url: `${MODEL_REPOSITORY}/sam_vit_h_4b8939_quant.zip`,
    sizeBytes: 442_519_065,
    archiveSha256: "b5ac1197e6ef960a5b8a0c722d4d0ad186460594db3822734441fbe375629584",
    encoderSizeBytes: 656_832_738,
    encoderCrc32: 0xaa6ceee8,
    decoderSizeBytes: 8_742_607,
    decoderCrc32: 0x2a5d9f1d,
    inputWidth: 1024,
    inputHeight: 682,
    description: "最高精度，适合边缘细节复杂的图片。"
  },
  {
    id: "sam-vit-l-quant",
    name: "SAM ViT-L",
    archiveFileName: "sam_vit_l_0b3195_quant.zip",
    encoderArchiveEntry: "sam_vit_l_0b3195.encoder.quant.onnx",
    decoderArchiveEntry: "sam_vit_l_0b3195.decoder.quant.onnx",
    url: `${MODEL_REPOSITORY}/sam_vit_l_0b3195_quant.zip`,
    sizeBytes: 223_604_628,
    archiveSha256: "37accba48a5657047381e73f36075a00e308309c7527f1ba0934e1237a7ec715",
    encoderSizeBytes: 332_583_297,
    encoderCrc32: 0xb6059872,
    decoderSizeBytes: 8_742_607,
    decoderCrc32: 0xbd998887,
    inputWidth: 1024,
    inputHeight: 682,
    recommended: true,
    description: "推荐档，高精度并兼顾本地占用。"
  }
];

export type CutoutModelFileKind = "encoder" | "decoder";
export type ModelInstallStage = "downloading" | "verifying" | "installing";

export interface ModelDownloadProgress {
  stage: ModelInstallStage;
  receivedBytes: number;
  totalBytes: number;
}

interface InstalledModelRecord {
  id: string;
  archiveSizeBytes: number;
  encoderFileName: string;
  decoderFileName: string;
  installedAt: string;
}

interface ModelManifest {
  version: number;
  installed: Record<string, InstalledModelRecord>;
}

interface ZipCentralDirectory {
  offset: number;
  entries: ZipEntry[];
}

interface ZipEntry {
  name: string;
  flags: number;
  compression: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

const isTauri = "__TAURI_INTERNALS__" in window;
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

function installedFileName(descriptor: CutoutModelDescriptor, kind: CutoutModelFileKind) {
  return `${descriptor.id}.${kind}.onnx`;
}

function modelFileIntegrity(
  descriptor: CutoutModelDescriptor,
  kind: CutoutModelFileKind
) {
  return kind === "encoder"
    ? { sizeBytes: descriptor.encoderSizeBytes, crc32: descriptor.encoderCrc32 }
    : { sizeBytes: descriptor.decoderSizeBytes, crc32: descriptor.decoderCrc32 };
}

function updateCrc32(previous: number, bytes: Uint8Array): number {
  let crc = previous ^ 0xffffffff;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function modelLocalPath(
  descriptor: CutoutModelDescriptor,
  modelsDir: string,
  kind: CutoutModelFileKind
) {
  return join(modelsDir, installedFileName(descriptor, kind));
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

export function findModelDescriptor(modelId: string): CutoutModelDescriptor | undefined {
  return CUTOUT_MODELS.find((model) => model.id === modelId);
}

export async function getModelStatus(
  descriptor: CutoutModelDescriptor
): Promise<CutoutModelStatus> {
  const modelsDir = await resolveModelsDir();
  if (!modelsDir) return "missing";

  try {
    const [encoderPath, decoderPath, manifest] = await Promise.all([
      modelLocalPath(descriptor, modelsDir, "encoder"),
      modelLocalPath(descriptor, modelsDir, "decoder"),
      readManifest(modelsDir)
    ]);
    const record = manifest.installed[descriptor.id];
    if (
      !record ||
      record.archiveSizeBytes !== descriptor.sizeBytes ||
      record.encoderFileName !== installedFileName(descriptor, "encoder") ||
      record.decoderFileName !== installedFileName(descriptor, "decoder")
    ) {
      return "missing";
    }
    const [hasEncoder, hasDecoder] = await Promise.all([
      exists(encoderPath),
      exists(decoderPath)
    ]);
    return hasEncoder && hasDecoder ? "ready" : "missing";
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

async function readExactlyAt(
  handle: FileHandle,
  offset: number,
  byteLength: number
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0
  ) {
    throw new Error("模型包目录包含无效偏移。");
  }

  await handle.seek(offset, SeekMode.Start);
  const bytes = new Uint8Array(byteLength);
  let bytesReadTotal = 0;
  while (bytesReadTotal < byteLength) {
    const bytesRead = await handle.read(bytes.subarray(bytesReadTotal));
    if (bytesRead === null || bytesRead <= 0) {
      throw new Error("模型包目录不完整，请重新下载。");
    }
    bytesReadTotal += bytesRead;
  }
  return bytes;
}

function decodeZipEntryName(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (exception) {
    throw new Error("模型包目录中的文件名无法识别。", { cause: exception });
  }
}

async function readZipCentralDirectory(
  archive: FileHandle,
  archiveSize: number
): Promise<ZipCentralDirectory> {
  const tailSize = Math.min(
    archiveSize,
    ZIP_EOCD_BYTES + ZIP_MAX_COMMENT_BYTES
  );
  if (tailSize < ZIP_EOCD_BYTES) {
    throw new Error("模型包不是有效的 ZIP 文件，请重新下载。");
  }

  const tailOffset = archiveSize - tailSize;
  const tail = await readExactlyAt(archive, tailOffset, tailSize);
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocdOffset = -1;
  for (let offset = tail.byteLength - ZIP_EOCD_BYTES; offset >= 0; offset -= 1) {
    if (tailView.getUint32(offset, true) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = tailView.getUint16(offset + 20, true);
    if (offset + ZIP_EOCD_BYTES + commentLength === tail.byteLength) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error("模型包缺少 ZIP 中央目录，请重新下载。");
  }

  const diskNumber = tailView.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = tailView.getUint16(eocdOffset + 6, true);
  const diskEntryCount = tailView.getUint16(eocdOffset + 8, true);
  const entryCount = tailView.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = tailView.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = tailView.getUint32(eocdOffset + 16, true);
  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || diskEntryCount !== entryCount) {
    throw new Error("模型包使用了不支持的分卷 ZIP 格式。");
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error("模型包使用了不支持的 ZIP64 格式。");
  }

  const absoluteEocdOffset = tailOffset + eocdOffset;
  if (
    centralDirectoryOffset > absoluteEocdOffset ||
    centralDirectorySize > absoluteEocdOffset - centralDirectoryOffset
  ) {
    throw new Error("模型包中央目录越界，请重新下载。");
  }

  const directoryBytes = await readExactlyAt(
    archive,
    centralDirectoryOffset,
    centralDirectorySize
  );
  const directoryView = new DataView(
    directoryBytes.buffer,
    directoryBytes.byteOffset,
    directoryBytes.byteLength
  );
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + ZIP_CENTRAL_DIRECTORY_HEADER_BYTES > directoryBytes.byteLength ||
      directoryView.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw new Error("模型包中央目录损坏，请重新下载。");
    }

    const fileNameLength = directoryView.getUint16(offset + 28, true);
    const extraFieldLength = directoryView.getUint16(offset + 30, true);
    const commentLength = directoryView.getUint16(offset + 32, true);
    const recordLength =
      ZIP_CENTRAL_DIRECTORY_HEADER_BYTES +
      fileNameLength +
      extraFieldLength +
      commentLength;
    if (recordLength > directoryBytes.byteLength - offset) {
      throw new Error("模型包中央目录条目不完整，请重新下载。");
    }

    const compressedSize = directoryView.getUint32(offset + 20, true);
    const uncompressedSize = directoryView.getUint32(offset + 24, true);
    const localHeaderOffset = directoryView.getUint32(offset + 42, true);
    const diskStart = directoryView.getUint16(offset + 34, true);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error("模型包条目使用了不支持的 ZIP64 格式。");
    }
    if (diskStart !== 0) {
      throw new Error("模型包条目位于不支持的 ZIP 分卷中。");
    }

    const fileNameOffset = offset + ZIP_CENTRAL_DIRECTORY_HEADER_BYTES;
    entries.push({
      name: decodeZipEntryName(
        directoryBytes.subarray(fileNameOffset, fileNameOffset + fileNameLength)
      ),
      flags: directoryView.getUint16(offset + 8, true),
      compression: directoryView.getUint16(offset + 10, true),
      crc32: directoryView.getUint32(offset + 16, true),
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    offset += recordLength;
  }

  if (offset !== directoryBytes.byteLength) {
    throw new Error("模型包中央目录包含无法识别的数据。");
  }
  return { offset: centralDirectoryOffset, entries };
}

function findModelZipEntry(
  directory: ZipCentralDirectory,
  expectedName: string
): ZipEntry {
  const matches = directory.entries.filter((entry) => {
    const entryName = entry.name.replaceAll("\\", "/").split("/").pop();
    return entryName === expectedName;
  });
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `模型包缺少 ${expectedName}。`
        : `模型包包含重复的 ${expectedName}。`
    );
  }
  return matches[0];
}

function validateModelZipEntry(
  descriptor: CutoutModelDescriptor,
  kind: CutoutModelFileKind,
  entry: ZipEntry
) {
  if (entry.flags & ZIP_ENCRYPTED_FLAG) {
    throw new Error(`模型包中的 ${kind} 文件已加密，无法安装。`);
  }
  if (
    entry.compression !== ZIP_COMPRESSION_STORED &&
    entry.compression !== ZIP_COMPRESSION_DEFLATE
  ) {
    throw new Error(
      `模型包格式异常（不支持 ZIP 压缩方法 ${entry.compression}）。`
    );
  }
  const integrity = modelFileIntegrity(descriptor, kind);
  if (
    entry.uncompressedSize !== integrity.sizeBytes ||
    entry.crc32 !== integrity.crc32 ||
    (entry.compression === ZIP_COMPRESSION_STORED &&
      entry.compressedSize !== entry.uncompressedSize)
  ) {
    throw new Error(`模型包中的 ${kind} 文件信息校验失败，请重新下载。`);
  }
}

async function resolveZipEntryDataOffset(
  archive: FileHandle,
  entry: ZipEntry,
  centralDirectoryOffset: number
): Promise<number> {
  const localHeader = await readExactlyAt(
    archive,
    entry.localHeaderOffset,
    ZIP_LOCAL_FILE_HEADER_BYTES
  );
  const localView = new DataView(
    localHeader.buffer,
    localHeader.byteOffset,
    localHeader.byteLength
  );
  if (localView.getUint32(0, true) !== ZIP_LOCAL_FILE_SIGNATURE) {
    throw new Error(`模型包中的 ${entry.name} 本地文件头损坏。`);
  }

  const flags = localView.getUint16(6, true);
  const compression = localView.getUint16(8, true);
  const fileNameLength = localView.getUint16(26, true);
  const extraFieldLength = localView.getUint16(28, true);
  if (flags !== entry.flags || compression !== entry.compression) {
    throw new Error(`模型包中的 ${entry.name} 文件头信息不一致。`);
  }

  const variableHeader = await readExactlyAt(
    archive,
    entry.localHeaderOffset + ZIP_LOCAL_FILE_HEADER_BYTES,
    fileNameLength + extraFieldLength
  );
  const localName = decodeZipEntryName(variableHeader.subarray(0, fileNameLength));
  if (localName !== entry.name) {
    throw new Error(`模型包中的 ${entry.name} 文件名信息不一致。`);
  }

  const dataOffset =
    entry.localHeaderOffset +
    ZIP_LOCAL_FILE_HEADER_BYTES +
    fileNameLength +
    extraFieldLength;
  if (
    dataOffset > centralDirectoryOffset ||
    entry.compressedSize > centralDirectoryOffset - dataOffset
  ) {
    throw new Error(`模型包中的 ${entry.name} 压缩数据越界。`);
  }
  return dataOffset;
}

async function extractZipEntry(
  archive: FileHandle,
  output: FileHandle,
  entry: ZipEntry,
  kind: CutoutModelFileKind,
  centralDirectoryOffset: number,
  onCompressedBytes: (byteLength: number) => void,
  signal?: AbortSignal
): Promise<{ sizeBytes: number; crc32: number }> {
  const dataOffset = await resolveZipEntryDataOffset(
    archive,
    entry,
    centralDirectoryOffset
  );
  await archive.seek(dataOffset, SeekMode.Start);

  const state = { sizeBytes: 0, crc32: 0 };
  let writeQueue = Promise.resolve();
  let reachedFinalBlock = entry.compression === ZIP_COMPRESSION_STORED;
  const consumeOutput = (bytes: Uint8Array) => {
    if (!bytes.byteLength) return;
    if (bytes.byteLength > entry.uncompressedSize - state.sizeBytes) {
      throw new Error(`模型包中的 ${kind} 文件解压大小异常。`);
    }
    const stableBytes = bytes.slice();
    state.sizeBytes += stableBytes.byteLength;
    state.crc32 = updateCrc32(state.crc32, stableBytes);
    writeQueue = writeQueue.then(() => writeAll(output, stableBytes));
  };
  const inflate = entry.compression === ZIP_COMPRESSION_DEFLATE
    ? new Inflate((bytes, final) => {
        consumeOutput(bytes);
        reachedFinalBlock ||= final;
      })
    : null;

  let remainingBytes = entry.compressedSize;
  const buffer = new Uint8Array(
    Math.min(ARCHIVE_READ_CHUNK_BYTES, Math.max(1, remainingBytes))
  );
  while (remainingBytes > 0) {
    if (signal?.aborted) throw new DOMException("模型安装已取消。", "AbortError");
    const requestedBytes = Math.min(buffer.byteLength, remainingBytes);
    const bytesRead = await archive.read(buffer.subarray(0, requestedBytes));
    if (bytesRead === null || bytesRead <= 0) {
      throw new Error(`模型包中的 ${kind} 压缩数据不完整，请重新下载。`);
    }

    remainingBytes -= bytesRead;
    const input = buffer.slice(0, bytesRead);
    try {
      if (inflate) inflate.push(input, remainingBytes === 0);
      else consumeOutput(input);
    } catch (exception) {
      throw new Error(`模型包中的 ${kind} 文件解压失败，请重新下载。`, {
        cause: exception
      });
    }
    await writeQueue;
    onCompressedBytes(bytesRead);
  }

  if (inflate && entry.compressedSize === 0) {
    try {
      inflate.push(new Uint8Array(), true);
    } catch (exception) {
      throw new Error(`模型包中的 ${kind} 文件解压失败，请重新下载。`, {
        cause: exception
      });
    }
  }
  await writeQueue;
  if (!reachedFinalBlock) {
    throw new Error(`模型包中的 ${kind} 压缩数据未正常结束，请重新下载。`);
  }
  return state;
}

async function downloadArchive(
  descriptor: CutoutModelDescriptor,
  archivePath: string,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
) {
  let response: Response;
  try {
    response = await fetchHttp(descriptor.url, { signal });
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
  let archive: FileHandle | null = null;
  let receivedBytes = 0;
  try {
    archive = await create(archivePath);
    for (;;) {
      if (signal?.aborted) throw new DOMException("模型下载已取消。", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      await writeAll(archive, value);
      receivedBytes += value.byteLength;
      onProgress?.({
        stage: "downloading",
        receivedBytes,
        totalBytes: descriptor.sizeBytes
      });
    }
  } finally {
    await archive?.close().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
  }

  if (receivedBytes !== descriptor.sizeBytes) {
    throw new Error(
      `模型包不完整（预期 ${descriptor.sizeBytes} 字节，实际 ${receivedBytes} 字节）。`
    );
  }
}

async function verifyArchive(
  descriptor: CutoutModelDescriptor,
  archivePath: string,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
) {
  let archive: FileHandle | null = null;
  let verifiedBytes = 0;
  const digest = sha256.create();

  try {
    archive = await open(archivePath, { read: true });
    const buffer = new Uint8Array(ARCHIVE_READ_CHUNK_BYTES);
    for (;;) {
      if (signal?.aborted) throw new DOMException("模型校验已取消。", "AbortError");
      const bytesRead = await archive.read(buffer);
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
    await archive?.close().catch(() => undefined);
  }

  const actualSha256 = bytesToHex(digest.digest());
  if (
    verifiedBytes !== descriptor.sizeBytes ||
    actualSha256 !== descriptor.archiveSha256
  ) {
    throw new Error("模型包校验失败，下载内容已损坏，请重试。");
  }
}

async function extractArchive(
  descriptor: CutoutModelDescriptor,
  archivePath: string,
  encoderPath: string,
  decoderPath: string,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal
) {
  let archive: FileHandle | null = null;

  try {
    archive = await open(archivePath, { read: true });
    const directory = await readZipCentralDirectory(archive, descriptor.sizeBytes);
    const entries = {
      encoder: findModelZipEntry(directory, descriptor.encoderArchiveEntry),
      decoder: findModelZipEntry(directory, descriptor.decoderArchiveEntry)
    };
    validateModelZipEntry(descriptor, "encoder", entries.encoder);
    validateModelZipEntry(descriptor, "decoder", entries.decoder);

    const totalCompressedBytes =
      entries.encoder.compressedSize + entries.decoder.compressedSize;
    let processedCompressedBytes = 0;
    const onCompressedBytes = (byteLength: number) => {
      processedCompressedBytes += byteLength;
      const ratio = totalCompressedBytes > 0
        ? processedCompressedBytes / totalCompressedBytes
        : 1;
      onProgress?.({
        stage: "installing",
        receivedBytes: Math.round(Math.min(1, ratio) * descriptor.sizeBytes),
        totalBytes: descriptor.sizeBytes
      });
    };

    for (const kind of ["encoder", "decoder"] as const) {
      if (signal?.aborted) throw new DOMException("模型安装已取消。", "AbortError");
      const outputPath = kind === "encoder" ? encoderPath : decoderPath;
      let output: FileHandle | null = null;
      let state: { sizeBytes: number; crc32: number } | null = null;
      try {
        output = await create(outputPath);
        state = await extractZipEntry(
          archive,
          output,
          entries[kind],
          kind,
          directory.offset,
          onCompressedBytes,
          signal
        );
      } finally {
        await output?.close().catch(() => undefined);
      }

      const integrity = modelFileIntegrity(descriptor, kind);
      if (
        !state ||
        state.sizeBytes !== integrity.sizeBytes ||
        state.crc32 !== integrity.crc32
      ) {
        throw new Error(`模型包中的 ${kind} 文件校验失败，请重新下载。`);
      }
    }
    onProgress?.({
      stage: "installing",
      receivedBytes: descriptor.sizeBytes,
      totalBytes: descriptor.sizeBytes
    });
  } finally {
    await archive?.close().catch(() => undefined);
  }
}

/**
 * 流式下载模型包，再根据 ZIP 中央目录记录的精确长度按块解压
 * encoder/decoder，避免扫描 data descriptor 和让大模型包整体驻留内存。
 */
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

  const [archivePath, encoderPath, decoderPath] = await Promise.all([
    join(modelsDir, `${descriptor.id}.download.zip`),
    modelLocalPath(descriptor, modelsDir, "encoder"),
    modelLocalPath(descriptor, modelsDir, "decoder")
  ]);
  await Promise.all([
    remove(archivePath).catch(() => undefined),
    remove(encoderPath).catch(() => undefined),
    remove(decoderPath).catch(() => undefined)
  ]);

  try {
    onProgress?.({ stage: "downloading", receivedBytes: 0, totalBytes: descriptor.sizeBytes });
    await downloadArchive(descriptor, archivePath, onProgress, signal);
    onProgress?.({ stage: "verifying", receivedBytes: 0, totalBytes: descriptor.sizeBytes });
    await verifyArchive(descriptor, archivePath, onProgress, signal);
    onProgress?.({ stage: "installing", receivedBytes: 0, totalBytes: descriptor.sizeBytes });
    await extractArchive(
      descriptor,
      archivePath,
      encoderPath,
      decoderPath,
      onProgress,
      signal
    );

    const manifest = await readManifest(modelsDir);
    manifest.installed[descriptor.id] = {
      id: descriptor.id,
      archiveSizeBytes: descriptor.sizeBytes,
      encoderFileName: installedFileName(descriptor, "encoder"),
      decoderFileName: installedFileName(descriptor, "decoder"),
      installedAt: new Date().toISOString()
    };
    await writeManifest(modelsDir, manifest);
  } catch (exception) {
    await Promise.all([
      remove(encoderPath).catch(() => undefined),
      remove(decoderPath).catch(() => undefined)
    ]);
    throw exception;
  } finally {
    await remove(archivePath).catch(() => undefined);
  }
}

export async function removeModel(descriptor: CutoutModelDescriptor): Promise<void> {
  if (!isTauri) return;
  const modelsDir = await resolveModelsDir();
  if (!modelsDir) return;
  const [encoderPath, decoderPath] = await Promise.all([
    modelLocalPath(descriptor, modelsDir, "encoder"),
    modelLocalPath(descriptor, modelsDir, "decoder")
  ]);
  await Promise.all([
    remove(encoderPath).catch(() => undefined),
    remove(decoderPath).catch(() => undefined)
  ]);
  const manifest = await readManifest(modelsDir);
  delete manifest.installed[descriptor.id];
  await writeManifest(modelsDir, manifest);
}
