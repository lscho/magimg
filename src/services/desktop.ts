import { open, save } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type { GeneratedImage, SelectedImageFile } from "@/types";

const isTauri = "__TAURI_INTERNALS__" in window;

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

export async function chooseImageFile(): Promise<SelectedImageFile | null> {
  if (!isTauri) {
    return await new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      input.hidden = true;

      const finish = (selected: SelectedImageFile | null) => {
        input.remove();
        resolve(selected);
      };
      input.addEventListener(
        "change",
        () => {
          const file = input.files?.[0];
          finish(file ? { name: file.name, path: file.name, file } : null);
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
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片下载失败（${response.status}）`);
  return new Uint8Array(await response.arrayBuffer());
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
  const filename = safeImageFilename(suggestedName, mimeType);

  if (!isTauri) {
    const bytes = await remoteImageBytes(url);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType || "image/png" }));
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
    filters: [imageFilter(mimeType)]
  });
  if (!path) return null;

  await writeFile(path, await remoteImageBytes(url));
  return path;
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
    await writeFile(`${directory}/${filename}`, await remoteImageBytes(image.remoteUrl));
  }
  return { savedCount: downloads.length, directory, cancelled: false };
}

export async function saveRemoteImage(url: string, directory: string, filename: string): Promise<string | undefined> {
  if (!isTauri || !directory) return undefined;

  await mkdir(directory, { recursive: true }).catch(() => undefined);
  const path = `${directory}/${filename}`;
  await writeFile(path, await remoteImageBytes(url));
  return path;
}
