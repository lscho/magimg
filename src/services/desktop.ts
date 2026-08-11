import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { platform } from "@tauri-apps/plugin-os";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type { GeneratedImage, SelectedImageFile } from "@/types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function isDesktopApp() {
  return isTauri;
}

export function fetchHttp(input: URL | Request | string, init?: RequestInit): Promise<Response> {
  return isTauri ? tauriFetch(input, init) : window.fetch(input, init);
}

export function hasWindowsWindowControls(): boolean {
  return isTauri && platform() === "windows";
}

export function disableAppContextMenu(): void {
  if (!isTauri) return;
  document.addEventListener("contextmenu", (event) => event.preventDefault());
}

export async function minimizeAppWindow(): Promise<void> {
  if (!hasWindowsWindowControls()) return;
  await getCurrentWindow().minimize();
}

export async function toggleAppWindowMaximized(): Promise<boolean> {
  if (!hasWindowsWindowControls()) return false;
  const appWindow = getCurrentWindow();
  await appWindow.toggleMaximize();
  return appWindow.isMaximized();
}

export async function isAppWindowMaximized(): Promise<boolean> {
  if (!hasWindowsWindowControls()) return false;
  return getCurrentWindow().isMaximized();
}

export async function closeAppWindow(): Promise<void> {
  if (!hasWindowsWindowControls()) return;
  await getCurrentWindow().close();
}

export async function onAppWindowResized(listener: () => void): Promise<UnlistenFn> {
  if (!hasWindowsWindowControls()) return () => undefined;
  return getCurrentWindow().onResized(() => listener());
}

export async function chooseDirectory(): Promise<string | null> {
  if (!isTauri) return "浏览器预览模式/幻画AI输出";
  const selected = await open({ directory: true, multiple: false, title: "选择图片保存目录" });
  return typeof selected === "string" ? selected : null;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/u).pop() || "reference-image";
}

function mimeTypeFromName(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  return "image/png";
}

export function selectedImageFileFromFile(file: File): SelectedImageFile {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const extensionMimeType = extension === "jpg" || extension === "jpeg"
    ? "image/jpeg"
    : extension === "webp"
      ? "image/webp"
      : extension === "png" ? "image/png" : null;
  const mimeType = ["image/jpeg", "image/png", "image/webp"].includes(file.type)
    ? file.type
    : extensionMimeType;

  if (!mimeType) throw new Error("仅支持 PNG、JPEG 和 WebP 图片。");

  const normalizedFile = file.type === mimeType
    ? file
    : new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
  return {
    name: normalizedFile.name,
    path: (file as File & { path?: string }).path || normalizedFile.name,
    file: normalizedFile
  };
}

export async function chooseImageFile(): Promise<SelectedImageFile | null> {
  if (!isTauri) {
    return await new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      input.hidden = true;

      const finish = (selected: SelectedImageFile | null) => {
        input.remove();
        resolve(selected);
      };
      const fail = (exception: unknown) => {
        input.remove();
        reject(exception);
      };
      input.addEventListener(
        "change",
        () => {
          const file = input.files?.[0];
          try {
            finish(file ? selectedImageFileFromFile(file) : null);
          } catch (exception) {
            fail(exception);
          }
        },
        { once: true }
      );
      input.addEventListener("cancel", () => finish(null), { once: true });
      document.body.append(input);
      input.click();
    });
  }

  const selected = await open({
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
  });
  if (typeof selected !== "string") return null;

  const name = fileNameFromPath(selected);
  const bytes = await readFile(selected);
  return {
    name,
    path: selected,
    file: new File([bytes], name, { type: mimeTypeFromName(name) })
  };
}

export async function autoLayerSelectionSourceExists(path: string): Promise<boolean> {
  if (!isTauri || !path) return false;
  return invoke<boolean>("auto_layer_selection_source_exists", { path });
}

export async function loadAutoLayerSelectionSource(path: string): Promise<SelectedImageFile> {
  if (!isTauri) throw new Error("选区记录仅支持桌面客户端。");
  const name = fileNameFromPath(path);
  const bytes = await invoke<ArrayBuffer>("auto_layer_read_selection_source", { path });
  return {
    name,
    path,
    file: new File([bytes], name, { type: mimeTypeFromName(name) })
  };
}

export async function openExternal(target: string): Promise<void> {
  if (!target) return;
  if (!isTauri) {
    window.open(target, "_blank", "noopener,noreferrer");
    return;
  }
  if (/^https?:\/\//.test(target)) {
    await openUrl(target);
    return;
  }
  await openPath(target);
}

export async function openDirectory(path: string): Promise<void> {
  if (!path) return;
  if (!isTauri) {
    window.alert("浏览器预览无法打开本地文件夹，请在桌面客户端中使用此功能。");
    return;
  }
  await openPath(path);
}

function imageExtension(mimeType?: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function imageFilter(mimeType?: string) {
  if (mimeType === "image/jpeg") return { name: "JPEG 图片", extensions: ["jpg", "jpeg"] };
  if (mimeType === "image/webp") return { name: "WebP 图片", extensions: ["webp"] };
  return { name: "PNG 图片", extensions: ["png"] };
}

async function remoteImageBytes(url: string) {
  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(url, window.location.href);
  } catch {
    throw new Error("图片地址无效，无法下载。");
  }
  const canReadBrowserBlob = !isTauri && resolvedUrl.protocol === "blob:";
  if (resolvedUrl.protocol !== "http:" && resolvedUrl.protocol !== "https:" && !canReadBrowserBlob) {
    throw new Error("仅支持读取 HTTP、HTTPS 或浏览器临时图片。");
  }

  let response: Response;
  try {
    response = await fetchHttp(resolvedUrl);
  } catch (exception) {
    throw new Error("图片加载失败，请检查网络连接后重试。", { cause: exception });
  }
  if (!response.ok) throw new Error(`图片下载失败（${response.status}）`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function loadRemoteImageBlob(url: string, mimeType?: string) {
  const bytes = await remoteImageBytes(url);
  return new Blob([bytes], { type: mimeType || "image/png" });
}

async function imageBlobAsPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前设备无法处理该图片。");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (pngBlob) => (pngBlob ? resolve(pngBlob) : reject(new Error("图片格式转换失败。"))),
        "image/png"
      );
    });
  } finally {
    bitmap.close();
  }
}

export async function copyRemoteImageToClipboard(url: string, mimeType?: string): Promise<void> {
  await copyImageBlobToClipboard(await loadRemoteImageBlob(url, mimeType));
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error("当前系统不支持复制文字。");
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch (exception) {
    throw new Error("无法复制文字，请检查系统剪贴板权限。", { cause: exception });
  }
}

export async function copyImageBlobToClipboard(blob: Blob): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前系统不支持复制图片，请使用下载功能。");
  }

  const pngBlob = await imageBlobAsPng(blob);
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
  } catch (exception) {
    throw new Error("无法复制图片，请检查系统剪贴板权限。", { cause: exception });
  }
}

export async function remoteImageToSelectedFile(
  url: string,
  suggestedName: string,
  mimeType?: string
): Promise<SelectedImageFile> {
  const normalizedMimeType = ["image/jpeg", "image/png", "image/webp"].includes(mimeType || "")
    ? mimeType!
    : "image/png";
  const blob = await loadRemoteImageBlob(url, normalizedMimeType);
  return imageBlobToSelectedFile(blob, suggestedName, normalizedMimeType);
}

export function imageBlobToSelectedFile(
  blob: Blob,
  suggestedName: string,
  mimeType?: string
): SelectedImageFile {
  const normalizedMimeType = ["image/jpeg", "image/png", "image/webp"].includes(mimeType || blob.type)
    ? (mimeType || blob.type)
    : "image/png";
  const name = safeImageFilename(suggestedName, normalizedMimeType);
  return {
    name,
    path: name,
    file: new File([blob], name, { type: normalizedMimeType })
  };
}

async function writeImageFile(path: string, bytes: Uint8Array) {
  try {
    await writeFile(path, bytes);
  } catch (exception) {
    throw new Error("无法写入所选目录，请确认目录可写后重试。", { cause: exception });
  }
}

function safeImageFilename(suggestedName: string, mimeType?: string) {
  const extension = imageExtension(mimeType);
  const basename = suggestedName.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-");
  return `${basename}.${extension}`;
}

export async function saveRemoteImageAs(
  url: string,
  suggestedName: string,
  mimeType?: string
): Promise<string | null> {
  if (!url) return null;
  return saveImageBlobAs(await loadRemoteImageBlob(url, mimeType), suggestedName, mimeType);
}

export async function saveImageBlobAs(
  blob: Blob,
  suggestedName: string,
  mimeType?: string
): Promise<string | null> {
  const resolvedMimeType = mimeType || blob.type || "image/png";
  const filename = safeImageFilename(suggestedName, resolvedMimeType);

  if (!isTauri) {
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(blobUrl);
    return filename;
  }

  const path = await save({
    title: "保存生成图片",
    defaultPath: filename,
    filters: [imageFilter(resolvedMimeType)]
  });
  if (!path) return null;

  await writeImageFile(path, new Uint8Array(await blob.arrayBuffer()));
  return path;
}

export interface LocalImageDownload {
  blob: Blob;
  suggestedName: string;
  mimeType?: string;
}

export async function saveImageBlobsToDirectory(
  downloads: LocalImageDownload[]
): Promise<BatchDownloadResult> {
  if (!downloads.length) {
    return { savedCount: 0, directory: null, cancelled: false };
  }

  if (!isTauri) {
    for (const download of downloads) {
      const mimeType = download.mimeType || download.blob.type || "image/png";
      const blobUrl = URL.createObjectURL(download.blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = safeImageFilename(download.suggestedName, mimeType);
      anchor.click();
      URL.revokeObjectURL(blobUrl);
    }
    return { savedCount: downloads.length, directory: null, cancelled: false };
  }

  const directory = await open({
    directory: true,
    multiple: false,
    title: "选择透明素材保存目录"
  });
  if (typeof directory !== "string") {
    return { savedCount: 0, directory: null, cancelled: true };
  }

  await mkdir(directory, { recursive: true }).catch(() => undefined);
  for (const download of downloads) {
    const mimeType = download.mimeType || download.blob.type || "image/png";
    const filename = safeImageFilename(download.suggestedName, mimeType);
    await writeImageFile(
      `${directory}/${filename}`,
      new Uint8Array(await download.blob.arrayBuffer())
    );
  }
  return { savedCount: downloads.length, directory, cancelled: false };
}

export interface ProjectFile {
  relativePath: string;
  contents: Blob | string;
}

export async function saveProjectDirectory(suggestedName: string, files: readonly ProjectFile[]) {
  if (!isTauri) throw new Error("浏览器预览不能导出自动分层项目，请在桌面客户端中使用。");
  const parent = await open({
    directory: true,
    multiple: false,
    recursive: true,
    title: "选择分层项目保存位置"
  });
  if (typeof parent !== "string") return null;
  const safeName = suggestedName.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-").replace(/^\.+|\.+$/gu, "") || "image-layers";
  let directory = await join(parent, safeName);
  let suffix = 2;
  while (await exists(directory)) {
    directory = await join(parent, `${safeName}-${suffix}`);
    suffix += 1;
  }
  await mkdir(directory, { recursive: false });
  for (const file of files) {
    const segments = file.relativePath.split("/").filter(Boolean);
    if (!segments.length || segments.some(segment => segment === "." || segment === "..")) {
      throw new Error("分层项目包含无效文件路径。");
    }
    const filename = segments.pop()!;
    let targetDirectory = directory;
    for (const segment of segments) targetDirectory = await join(targetDirectory, segment);
    if (segments.length) await mkdir(targetDirectory, { recursive: true });
    const path = await join(targetDirectory, filename);
    const bytes = typeof file.contents === "string"
      ? new TextEncoder().encode(file.contents)
      : new Uint8Array(await file.contents.arrayBuffer());
    await writeImageFile(path, bytes);
  }
  return directory;
}

export interface BatchImageDownload {
  image: GeneratedImage;
  suggestedName: string;
}

export interface BatchDownloadResult {
  savedCount: number;
  directory: string | null;
  cancelled: boolean;
}

export async function saveRemoteImagesToDirectory(
  downloads: BatchImageDownload[]
): Promise<BatchDownloadResult> {
  if (!downloads.length) return { savedCount: 0, directory: null, cancelled: false };

  if (!isTauri) {
    for (const { image, suggestedName } of downloads) {
      const bytes = await remoteImageBytes(image.remoteUrl);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: image.mimeType || "image/png" }));
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = safeImageFilename(suggestedName, image.mimeType);
      anchor.click();
      URL.revokeObjectURL(blobUrl);
    }
    return { savedCount: downloads.length, directory: null, cancelled: false };
  }

  const directory = await open({
    directory: true,
    multiple: false,
    title: "选择历史作品保存目录"
  });
  if (typeof directory !== "string") {
    return { savedCount: 0, directory: null, cancelled: true };
  }

  await mkdir(directory, { recursive: true }).catch(() => undefined);
  for (const { image, suggestedName } of downloads) {
    const filename = safeImageFilename(suggestedName, image.mimeType);
    await writeImageFile(`${directory}/${filename}`, await remoteImageBytes(image.remoteUrl));
  }
  return { savedCount: downloads.length, directory, cancelled: false };
}

export async function saveRemoteImage(url: string, directory: string, filename: string): Promise<string | undefined> {
  if (!isTauri || !directory) return undefined;

  await mkdir(directory, { recursive: true }).catch(() => undefined);
  const path = `${directory}/${filename}`;
  await writeImageFile(path, await remoteImageBytes(url));
  return path;
}
