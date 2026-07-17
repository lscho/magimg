import { arch, platform } from "@tauri-apps/plugin-os";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

export type ClientUpdatePlatform = "windows-x86" | "windows-arm" | "macos-x86" | "macos-arm";

export interface DesktopUpdateInfo {
  currentVersion: string;
  version: string;
  platform: ClientUpdatePlatform;
  fileName: string;
  fileSize: number | null;
  notes: string;
  publishTime: string | null;
  isForceUpdate: boolean;
}

export interface DesktopUpdateProgress {
  phase: "downloading" | "installing";
  downloadedBytes: number;
  totalBytes: number | null;
}

export interface DesktopUpdateHandle {
  info: DesktopUpdateInfo;
  install: (onProgress: (progress: DesktopUpdateProgress) => void) => Promise<void>;
  restart: () => Promise<void>;
  close: () => Promise<void>;
}

interface UpdaterRawMetadata {
  fileName?: unknown;
  fileSize?: unknown;
  notes?: unknown;
  pub_date?: unknown;
  isForceUpdate?: unknown;
  url?: unknown;
}

const isTauri = "__TAURI_INTERNALS__" in window;
const updaterEnabled = import.meta.env.VITE_ENABLE_UPDATER === "true";

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function fileNameFromUrl(value: unknown) {
  const rawUrl = stringValue(value);
  if (!rawUrl) return "更新包";
  try {
    const pathname = new URL(rawUrl).pathname;
    return decodeURIComponent(pathname.split("/").pop() || "更新包");
  } catch {
    return "更新包";
  }
}

async function clientUpdatePlatform(): Promise<ClientUpdatePlatform | null> {
  const [os, architecture] = await Promise.all([platform(), arch()]);
  if (os === "windows") {
    if (architecture === "aarch64") return "windows-arm";
    if (architecture === "x86_64") return "windows-x86";
  }
  if (os === "macos") {
    if (architecture === "aarch64") return "macos-arm";
    if (architecture === "x86_64") return "macos-x86";
  }
  return null;
}

function updateInfo(update: Update, target: ClientUpdatePlatform): DesktopUpdateInfo {
  const raw = update.rawJson as UpdaterRawMetadata;
  const notes = stringValue(update.body) || stringValue(raw.notes);
  const rawFileName = stringValue(raw.fileName);

  return {
    currentVersion: update.currentVersion,
    version: update.version,
    platform: target,
    fileName: rawFileName || fileNameFromUrl(raw.url),
    fileSize: positiveInteger(raw.fileSize),
    notes,
    publishTime: stringValue(update.date) || stringValue(raw.pub_date) || null,
    isForceUpdate: raw.isForceUpdate === true
  };
}

function installUpdate(update: Update, expectedSize: number | null, onProgress: (progress: DesktopUpdateProgress) => void) {
  let downloadedBytes = 0;
  let totalBytes = expectedSize;

  return update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      totalBytes = positiveInteger(event.data.contentLength) ?? totalBytes;
      onProgress({ phase: "downloading", downloadedBytes, totalBytes });
      return;
    }
    if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      onProgress({ phase: "downloading", downloadedBytes, totalBytes });
      return;
    }
    if (totalBytes) downloadedBytes = totalBytes;
    onProgress({ phase: "installing", downloadedBytes, totalBytes });
  });
}

export async function checkDesktopUpdate(): Promise<DesktopUpdateHandle | null> {
  if (!isTauri || !updaterEnabled) return null;

  const target = await clientUpdatePlatform();
  if (!target) return null;

  const update = await check({ target, timeout: 15_000 });
  if (!update) return null;

  const info = updateInfo(update, target);
  return {
    info,
    install: (onProgress) => installUpdate(update, info.fileSize, onProgress),
    restart: relaunch,
    close: () => update.close()
  };
}
