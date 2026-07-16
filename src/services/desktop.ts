import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, readFile, writeFile } from "@tauri-apps/plugin-fs";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import type { SelectedImageFile } from "@/types";

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
