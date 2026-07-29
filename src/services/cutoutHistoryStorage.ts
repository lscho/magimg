import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { localDb } from "@/services/localStorage";
import type {
  CutoutHistoryAsset,
  CutoutHistoryRecord,
  CutoutResult,
  CutoutSelection,
  SelectedImageFile
} from "@/types";
import {
  cloneCutoutSelections
} from "@/services/cutoutSelectionModel";
import {
  isStoredCutoutHistoryRecord,
  normalizeCutoutHistoryRecord
} from "@/services/cutoutHistoryModel";

const isTauri = "__TAURI_INTERNALS__" in window;
const HISTORY_DIRECTORY = "cutout-history";
const HISTORY_LIMIT = 100;
const TASK_ID_PATTERN = /^cutout-[a-zA-Z0-9-]+$/u;
const STORED_FILE_PATTERN = /^(?:source\.(?:png|jpg|webp)|result-\d+\.png)$/u;

export interface CreateCutoutHistoryInput {
  mattingId: string;
  costCredits: number;
  selectedFile: SelectedImageFile;
  sourceWidth: number;
  sourceHeight: number;
  selections: CutoutSelection[];
  results: CutoutResult[];
  cloudInputAssetId?: string;
}

export interface CutoutHistoryWorkspace {
  selectedFile: SelectedImageFile;
  selections: CutoutSelection[];
  results: CutoutResult[];
  cloudInputAssetId?: string;
}

export interface LoadedCutoutAsset {
  blob: Blob;
  suggestedName: string;
  mimeType: "image/png";
}

function requireDesktop() {
  if (!isTauri) throw new Error("AI 抠图历史仅支持桌面客户端。");
}

function sourceMimeType(file: File): CutoutHistoryRecord["source"]["mimeType"] {
  if (file.type === "image/jpeg" || file.type === "image/webp") return file.type;
  return "image/png";
}

function sourceExtension(mimeType: CutoutHistoryRecord["source"]["mimeType"]) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function newTaskId() {
  return `cutout-${Date.now()}-${crypto.randomUUID()}`;
}

function assertSafeTaskId(taskId: string) {
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error("抠图历史任务标识无效。");
}

function assertSafeStoredFileName(fileName: string) {
  if (!STORED_FILE_PATTERN.test(fileName)) throw new Error("抠图历史文件标识无效。");
}

async function historyRoot() {
  requireDesktop();
  return join(await appDataDir(), HISTORY_DIRECTORY);
}

async function taskDirectory(taskId: string) {
  assertSafeTaskId(taskId);
  return join(await historyRoot(), taskId);
}

async function taskFilePath(taskId: string, fileName: string) {
  assertSafeStoredFileName(fileName);
  return join(await taskDirectory(taskId), fileName);
}

export async function readCutoutHistoryRecords(): Promise<CutoutHistoryRecord[]> {
  if (!isTauri) return [];
  const records = await localDb.readCutoutHistory();
  if (!Array.isArray(records)) return [];
  return records
    .filter(isStoredCutoutHistoryRecord)
    .map((record) => normalizeCutoutHistoryRecord(record as unknown as Record<string, unknown>))
    .filter((record): record is CutoutHistoryRecord => Boolean(record))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, HISTORY_LIMIT);
}

async function removeTaskDirectory(taskId: string) {
  await remove(await taskDirectory(taskId), { recursive: true }).catch(() => undefined);
}

export async function createCutoutHistoryRecord(
  input: CreateCutoutHistoryInput,
  currentHistory: CutoutHistoryRecord[]
): Promise<CutoutHistoryRecord[]> {
  requireDesktop();
  if (!input.results.length) throw new Error("没有可保存的抠图结果。");

  const taskId = newTaskId();
  const directory = await taskDirectory(taskId);
  const mimeType = sourceMimeType(input.selectedFile.file);
  const sourceFileName = `source.${sourceExtension(mimeType)}`;
  const assets: CutoutHistoryAsset[] = input.results.map((result, index) => ({
    id: `${taskId}-asset-${index + 1}`,
    storedFileName: `result-${index + 1}.png`,
    baseName: result.baseName,
    width: result.width,
    height: result.height,
    thumbnailUrl: result.thumbnailUrl,
    sourceBox: { ...result.sourceBox },
    sourceSelectionId: result.sourceSelectionId,
    kind: result.kind,
    ...(result.repairMode ? { repairMode: result.repairMode } : {})
  }));
  const record: CutoutHistoryRecord = {
    schemaVersion: 2,
    id: taskId,
    mattingId: input.mattingId,
    source: {
      originalName: input.selectedFile.name,
      storedFileName: sourceFileName,
      mimeType,
      width: input.sourceWidth,
      height: input.sourceHeight,
      ...(input.cloudInputAssetId ? { cloudInputAssetId: input.cloudInputAssetId } : {})
    },
    selections: cloneCutoutSelections(input.selections),
    assets,
    costCredits: input.costCredits,
    createdAt: new Date().toISOString()
  };

  await mkdir(directory, { recursive: true });
  try {
    await writeFile(
      await taskFilePath(taskId, sourceFileName),
      new Uint8Array(await input.selectedFile.file.arrayBuffer())
    );
    for (let index = 0; index < input.results.length; index += 1) {
      await writeFile(
        await taskFilePath(taskId, assets[index].storedFileName),
        new Uint8Array(await input.results[index].blob.arrayBuffer())
      );
    }

    const merged = [record, ...currentHistory.filter((item) => item.id !== record.id)];
    const nextHistory = merged.slice(0, HISTORY_LIMIT);
    const pruned = merged.slice(HISTORY_LIMIT);
    await localDb.writeCutoutHistory(nextHistory);
    await Promise.all(pruned.map((item) => removeTaskDirectory(item.id)));
    return nextHistory;
  } catch (exception) {
    await removeTaskDirectory(taskId);
    throw new Error("抠图结果已生成，但保存历史失败。", { cause: exception });
  }
}

export async function removeCutoutHistoryRecords(
  taskIds: string[],
  currentHistory: CutoutHistoryRecord[]
): Promise<CutoutHistoryRecord[]> {
  requireDesktop();
  const ids = new Set(taskIds);
  const nextHistory = currentHistory.filter((record) => !ids.has(record.id));
  await localDb.writeCutoutHistory(nextHistory);
  await Promise.all([...ids].map((taskId) => removeTaskDirectory(taskId)));
  return nextHistory;
}

export async function loadCutoutHistoryAsset(
  record: CutoutHistoryRecord,
  asset: CutoutHistoryAsset
): Promise<LoadedCutoutAsset> {
  requireDesktop();
  if (!record.assets.some((candidate) => candidate.id === asset.id)) {
    throw new Error("该素材不属于当前抠图任务。");
  }
  try {
    const bytes = await readFile(await taskFilePath(record.id, asset.storedFileName));
    return {
      blob: new Blob([bytes], { type: "image/png" }),
      suggestedName: asset.baseName,
      mimeType: "image/png"
    };
  } catch (exception) {
    throw new Error("本地透明素材缺失或已损坏。", { cause: exception });
  }
}

export async function loadCutoutHistoryAssets(
  records: CutoutHistoryRecord[]
): Promise<LoadedCutoutAsset[]> {
  const loaded: LoadedCutoutAsset[] = [];
  for (const record of records) {
    for (const asset of record.assets) {
      loaded.push(await loadCutoutHistoryAsset(record, asset));
    }
  }
  return loaded;
}

export async function loadCutoutHistoryWorkspace(
  record: CutoutHistoryRecord
): Promise<CutoutHistoryWorkspace> {
  requireDesktop();
  try {
    const sourceBytes = await readFile(
      await taskFilePath(record.id, record.source.storedFileName)
    );
    const selectedFile: SelectedImageFile = {
      name: record.source.originalName,
      path: record.source.originalName,
      file: new File([sourceBytes], record.source.originalName, { type: record.source.mimeType })
    };
    const loadedAssets = await Promise.all(
      record.assets.map((asset) => loadCutoutHistoryAsset(record, asset))
    );
    const results: CutoutResult[] = record.assets.map((asset, index) => ({
      id: asset.id,
      blob: loadedAssets[index].blob,
      thumbnailUrl: asset.thumbnailUrl,
      width: asset.width,
      height: asset.height,
      sourceBox: { ...asset.sourceBox },
      sourceSelectionId: asset.sourceSelectionId,
      kind: asset.kind,
      ...(asset.repairMode ? { repairMode: asset.repairMode } : {}),
      baseName: asset.baseName
    }));
    return {
      selectedFile,
      selections: cloneCutoutSelections(record.selections),
      results,
      ...(record.source.cloudInputAssetId
        ? { cloudInputAssetId: record.source.cloudInputAssetId }
        : {})
    };
  } catch (exception) {
    if (exception instanceof Error && exception.message === "本地透明素材缺失或已损坏。") {
      throw exception;
    }
    throw new Error("本地原图缺失或已损坏，无法恢复工作。", { cause: exception });
  }
}
