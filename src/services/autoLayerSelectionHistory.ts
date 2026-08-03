import {
  autoLayerSelectionSourceExists,
  isDesktopApp,
  loadAutoLayerSelectionSource
} from "@/services/desktop";
import { readJsonValue, writeJsonValue } from "@/services/localStorage";
import {
  isAbsoluteLocalImagePath,
  normalizeAutoLayerSelectionRecord
} from "@/services/autoLayerSelectionHistoryModel";
import { cloneCutoutSelections } from "@/services/cutoutSelectionModel";
import type { AutoLayerSelectionRecord, CutoutSelection, SelectedImageFile } from "@/types";

const STORE_FILE = "auto-layer-selections.json";
const STORE_KEY = "items";
const RECORD_LIMIT = 50;
const THUMBNAIL_WIDTH = 240;
const THUMBNAIL_HEIGHT = 144;

export interface CreateAutoLayerSelectionRecordInput {
  selectedFile: SelectedImageFile;
  sourceWidth: number;
  sourceHeight: number;
  selections: CutoutSelection[];
}

export interface AutoLayerSelectionHistoryResult {
  records: AutoLayerSelectionRecord[];
  removedCount: number;
}

function requireDesktop() {
  if (!isDesktopApp()) throw new Error("选区记录仅支持桌面客户端。");
}

function sourceMimeType(file: File): AutoLayerSelectionRecord["sourceMimeType"] {
  if (file.type === "image/jpeg" || file.type === "image/webp") return file.type;
  return "image/png";
}

async function createThumbnail(file: File) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, THUMBNAIL_WIDTH / bitmap.width, THUMBNAIL_HEIGHT / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前设备无法生成选区预览。");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL("image/webp", 0.78);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    bitmap.close();
  }
}

async function storedRecords() {
  const values = await readJsonValue<unknown[]>(STORE_FILE, STORE_KEY, []);
  if (!Array.isArray(values)) return [];
  return values
    .map(normalizeAutoLayerSelectionRecord)
    .filter((record): record is AutoLayerSelectionRecord => Boolean(record))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, RECORD_LIMIT);
}

async function writeRecords(records: AutoLayerSelectionRecord[]) {
  requireDesktop();
  await writeJsonValue(STORE_FILE, STORE_KEY, records.slice(0, RECORD_LIMIT));
}

export async function readAutoLayerSelectionRecords(): Promise<AutoLayerSelectionHistoryResult> {
  if (!isDesktopApp()) return { records: [], removedCount: 0 };
  const records = await storedRecords();
  const checks = await Promise.all(records.map(record => autoLayerSelectionSourceExists(record.sourcePath)));
  const available = records.filter((_record, index) => checks[index]);
  const removedCount = records.length - available.length;
  if (removedCount) await writeRecords(available);
  return { records: available, removedCount };
}

export async function createAutoLayerSelectionRecord(
  input: CreateAutoLayerSelectionRecordInput
): Promise<AutoLayerSelectionRecord[]> {
  requireDesktop();
  if (!isAbsoluteLocalImagePath(input.selectedFile.path)) {
    throw new Error("当前图片没有可恢复的本地路径，请使用左侧导入按钮重新选择原图。");
  }
  if (!input.selections.length) throw new Error("请先框选元素或文字。");
  if (!await autoLayerSelectionSourceExists(input.selectedFile.path)) {
    throw new Error("原图路径已不存在，无法保存选区。");
  }
  const record: AutoLayerSelectionRecord = {
    schemaVersion: 1,
    id: `auto-layer-selection-${Date.now()}-${crypto.randomUUID()}`,
    sourcePath: input.selectedFile.path,
    sourceName: input.selectedFile.name,
    sourceMimeType: sourceMimeType(input.selectedFile.file),
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    thumbnailUrl: await createThumbnail(input.selectedFile.file),
    selections: cloneCutoutSelections(input.selections),
    createdAt: new Date().toISOString()
  };
  const current = await storedRecords();
  const next = [record, ...current].slice(0, RECORD_LIMIT);
  await writeRecords(next);
  return next;
}

export async function removeAutoLayerSelectionRecord(recordId: string) {
  requireDesktop();
  const next = (await storedRecords()).filter(record => record.id !== recordId);
  await writeRecords(next);
  return next;
}

export async function restoreAutoLayerSelectionRecord(record: AutoLayerSelectionRecord) {
  requireDesktop();
  if (!await autoLayerSelectionSourceExists(record.sourcePath)) {
    await removeAutoLayerSelectionRecord(record.id);
    throw new Error("原图已被移动或删除，该条选区记录已自动清除。");
  }
  return {
    selectedFile: await loadAutoLayerSelectionSource(record.sourcePath),
    selections: cloneCutoutSelections(record.selections)
  };
}

