import { Channel, invoke, isTauri as isTauriApi } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CompressionInputMode,
  CompressionPreparedSession,
  CompressionProgressEvent,
  CompressionSaveSummary,
  CompressionSettings,
  CompressionSummary
} from "@/types";

export function isDesktopRuntime(): boolean {
  return isTauriApi() ||
    (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);
}

export async function chooseCompressionFiles(): Promise<string[]> {
  if (!isDesktopRuntime()) return [];
  const selected = await open({
    title: "添加待压缩图片",
    multiple: true,
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }]
  });
  if (Array.isArray(selected)) return selected;
  return typeof selected === "string" ? [selected] : [];
}

export async function chooseCompressionFolder(): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const selected = await open({ directory: true, multiple: false, title: "选择源文件夹" });
  return typeof selected === "string" ? selected : null;
}

export async function chooseCompressionOutputFolder(
  inputMode: CompressionInputMode = "files"
): Promise<string | null> {
  if (!isDesktopRuntime()) return null;
  const title = inputMode === "folder" ? "选择压缩文件夹的保存位置" : "选择输出文件夹";
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

export async function prepareCompression(
  inputMode: CompressionInputMode,
  inputPaths: string[],
  existingSessionId?: string,
  existingItemIds: string[] = []
): Promise<CompressionPreparedSession> {
  return invoke<CompressionPreparedSession>("compression_prepare", {
    inputMode,
    inputPaths,
    existingSessionId: existingSessionId ?? null,
    existingItemIds
  });
}

export async function loadCompressionThumbnail(
  sessionId: string,
  itemId: string
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("compression_thumbnail", { sessionId, itemId });
}

export async function runCompression(
  sessionId: string,
  itemIds: string[],
  settings: CompressionSettings,
  onProgress: (event: CompressionProgressEvent) => void
): Promise<CompressionSummary> {
  const channel = new Channel<CompressionProgressEvent>();
  channel.onmessage = onProgress;
  return invoke<CompressionSummary>("compression_run", {
    sessionId,
    itemIds,
    settings,
    onProgress: channel
  });
}

export async function saveCompressionResults(
  sessionId: string,
  itemIds: string[],
  outputRoot: string,
  settings: CompressionSettings
): Promise<CompressionSaveSummary> {
  return invoke<CompressionSaveSummary>("compression_save", {
    sessionId,
    itemIds,
    outputRoot,
    settings
  });
}

export async function cancelCompression(sessionId: string): Promise<void> {
  await invoke("compression_cancel", { sessionId });
}

export async function releaseCompression(sessionId: string): Promise<void> {
  await invoke("compression_release", { sessionId });
}

export async function onCompressionFileDrop(
  listener: (paths: string[]) => void
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) return () => undefined;
  return getCurrentWindow().onDragDropEvent((event) => {
    if (event.payload.type === "drop") listener(event.payload.paths);
  });
}
