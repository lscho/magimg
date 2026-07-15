import { Store } from "@tauri-apps/plugin-store";
import { defaultSettings } from "@/constants/defaults";
import type { AppSettings, GenerationRecord, UserSession } from "@/types";

const memoryStore = new Map<string, unknown>();
const isTauri = "__TAURI_INTERNALS__" in window;

async function getStore(filename: string) {
  if (!isTauri) return null;
  return await Store.load(filename, { defaults: {}, autoSave: false });
}

export async function readJsonValue<T>(filename: string, key: string, fallback: T): Promise<T> {
  if (!isTauri) {
    return (memoryStore.get(`${filename}:${key}`) as T | undefined) ?? fallback;
  }

  try {
    const store = await getStore(filename);
    return ((await store?.get<T>(key)) ?? fallback) as T;
  } catch (error) {
    console.warn(`Failed to read ${filename}:${key}`, error);
    return fallback;
  }
}

export async function writeJsonValue<T>(filename: string, key: string, value: T): Promise<void> {
  if (!isTauri) {
    memoryStore.set(`${filename}:${key}`, value);
    return;
  }

  const store = await getStore(filename);
  await store?.set(key, value);
  await store?.save();
}

export const localDb = {
  readSettings: () => readJsonValue<AppSettings>("settings.json", "settings", defaultSettings),
  writeSettings: (settings: AppSettings) => writeJsonValue("settings.json", "settings", settings),
  readHistory: () => readJsonValue<GenerationRecord[]>("history.json", "items", []),
  writeHistory: (history: GenerationRecord[]) => writeJsonValue("history.json", "items", history),
  readSession: () => readJsonValue<UserSession | null>("auth-cache.json", "session", null),
  writeSession: (session: UserSession | null) => writeJsonValue("auth-cache.json", "session", session)
};
