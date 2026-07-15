import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

const isTauri = "__TAURI_INTERNALS__" in window;

export async function chooseDirectory(): Promise<string | null> {
  if (!isTauri) return "浏览器预览模式/幻画AI输出";
  const selected = await open({ directory: true, multiple: false, title: "选择图片保存目录" });
  return typeof selected === "string" ? selected : null;
}

export async function chooseImageFile(): Promise<string | null> {
  if (!isTauri) return null;
  const selected = await open({
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }]
  });
  return typeof selected === "string" ? selected : null;
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
  await openExternal(path);
}

export async function saveRemoteImage(url: string, directory: string, filename: string): Promise<string | undefined> {
  if (!isTauri || !directory) return undefined;

  const response = await fetch(url);
  const buffer = new Uint8Array(await response.arrayBuffer());
  await mkdir(directory, { recursive: true }).catch(() => undefined);
  const path = `${directory}/${filename}`;
  await writeFile(path, buffer);
  return path;
}
