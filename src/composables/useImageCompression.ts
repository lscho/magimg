import { computed, onBeforeUnmount, shallowRef } from "vue";
import {
  cancelCompression,
  prepareCompression,
  releaseCompression,
  runCompression,
  saveCompressionResults
} from "@/services/imageCompression";
import type {
  CompressionInputMode,
  CompressionItemStatus,
  CompressionPreparedSession,
  CompressionProgressEvent,
  CompressionSaveSummary,
  CompressionSettings,
  CompressionSourceItem,
  CompressionSummary
} from "@/types";

export interface CompressionWorkspaceItem extends CompressionSourceItem {
  status: CompressionItemStatus;
  outputRelativePath: string | null;
  outputSize: number | null;
  savedPercent: number | null;
  message: string;
  saveStatus: "saved" | "skipped" | "failed" | null;
  saveMessage: string;
}

export type CompressionPhase =
  | "idle"
  | "preparing"
  | "ready"
  | "running"
  | "cancelling"
  | "saving"
  | "completed";

export const DEFAULT_COMPRESSION_SETTINGS: CompressionSettings = {
  conflictPolicy: "rename",
  skipNoBenefit: true
};

export function compressionWorkspaceItem(item: CompressionSourceItem): CompressionWorkspaceItem {
  return {
    ...item,
    status: "pending",
    outputRelativePath: null,
    outputSize: null,
    savedPercent: null,
    message: "",
    saveStatus: null,
    saveMessage: ""
  };
}

export function applyCompressionSave(
  items: readonly CompressionWorkspaceItem[],
  result: CompressionSaveSummary
): CompressionWorkspaceItem[] {
  const savedItems = new Map(result.items.map((item) => [item.itemId, item]));
  return items.map((item) => {
    const saved = savedItems.get(item.id);
    if (!saved) return item;
    return {
      ...item,
      outputRelativePath: saved.outputRelativePath || item.outputRelativePath,
      saveStatus: saved.status,
      saveMessage: saved.message || ""
    };
  });
}

export function compressionSaveToastMessage(result: CompressionSaveSummary): string {
  if (!result.saved) return "";
  const skipped = result.skipped ? `，跳过 ${result.skipped} 个` : "";
  return `已保存 ${result.saved} 个压缩结果${skipped}`;
}

export function applyCompressionProgress(
  items: readonly CompressionWorkspaceItem[],
  event: CompressionProgressEvent
): CompressionWorkspaceItem[] {
  if (event.type === "started") return [...items];
  if (event.type === "finished") {
    if (!event.summary.wasCancelled) return [...items];
    return items.map((item) =>
      item.status === "pending" ? { ...item, status: "cancelled" } : item
    );
  }
  return items.map((item) => {
    if (item.id !== event.itemId) return item;
    if (event.type === "itemStarted") {
      return { ...item, status: "processing", message: "" };
    }
    return {
      ...item,
      status: event.status,
      outputRelativePath: event.outputRelativePath,
      outputSize: event.outputSize,
      savedPercent: event.savedPercent,
      message: event.message || ""
    };
  });
}

export function useImageCompression() {
  const phase = shallowRef<CompressionPhase>("idle");
  const session = shallowRef<CompressionPreparedSession | null>(null);
  const items = shallowRef<CompressionWorkspaceItem[]>([]);
  const settings = shallowRef<CompressionSettings>({ ...DEFAULT_COMPRESSION_SETTINGS });
  const summary = shallowRef<CompressionSummary | null>(null);
  const hasSaved = shallowRef(false);
  const errorMessage = shallowRef("");
  const currentItem = shallowRef("");
  const completedCount = shallowRef(0);
  const progressTotal = shallowRef(0);

  const activeItems = computed(() => items.value.filter((item) => item.status !== "cancelled"));
  const canStart = computed(
    () =>
      Boolean(session.value && activeItems.value.length) &&
      phase.value !== "preparing" &&
      phase.value !== "running" &&
      phase.value !== "cancelling" &&
      phase.value !== "saving"
  );
  const isRunning = computed(() => phase.value === "running" || phase.value === "cancelling");
  const isBusy = computed(() => isRunning.value || phase.value === "saving");
  const successfulIds = computed(() =>
    items.value.filter((item) => item.status === "succeeded").map((item) => item.id)
  );
  const canSave = computed(
    () => phase.value === "completed" && successfulIds.value.length > 0
  );
  const progressPercent = computed(() =>
    progressTotal.value > 0 ? Math.round((completedCount.value / progressTotal.value) * 100) : 0
  );

  async function releaseCurrent() {
    const sessionId = session.value?.sessionId;
    session.value = null;
    if (sessionId) await releaseCompression(sessionId).catch(() => undefined);
  }

  async function prepare(inputMode: CompressionInputMode, paths: string[]) {
    if (!paths.length || isBusy.value) return;
    phase.value = "preparing";
    errorMessage.value = "";
    summary.value = null;
    hasSaved.value = false;
    try {
      const existingSessionId = inputMode === "files" && session.value?.inputMode === "files"
        ? session.value.sessionId
        : undefined;
      const prepared = await prepareCompression(
        inputMode,
        paths,
        existingSessionId,
        items.value.map((item) => item.id)
      );
      await releaseCurrent();
      session.value = prepared;
      items.value = prepared.items.map(compressionWorkspaceItem);
      phase.value = "ready";
    } catch (error) {
      phase.value = items.value.length ? "ready" : "idle";
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  function removeItem(itemId: string) {
    if (isBusy.value) return;
    items.value = items.value.filter((item) => item.id !== itemId);
    summary.value = null;
    hasSaved.value = false;
    if (!items.value.length) void clear();
  }

  async function clear() {
    if (isBusy.value) return;
    await releaseCurrent();
    items.value = [];
    summary.value = null;
    hasSaved.value = false;
    currentItem.value = "";
    completedCount.value = 0;
    progressTotal.value = 0;
    errorMessage.value = "";
    phase.value = "idle";
  }

  function retryFailed() {
    if (isBusy.value) return;
    items.value = items.value.map((item) =>
      item.status === "failed" ? compressionWorkspaceItem(item) : item
    );
    summary.value = null;
    hasSaved.value = false;
    phase.value = "ready";
  }

  function handleProgress(event: CompressionProgressEvent) {
    if (event.type === "started") {
      progressTotal.value = event.total;
      return;
    }
    if (event.type === "itemStarted") {
      currentItem.value = event.relativePath;
    }
    if (event.type === "itemFinished") {
      completedCount.value += 1;
    }
    if (event.type === "finished") summary.value = event.summary;
    items.value = applyCompressionProgress(items.value, event);
  }

  async function start(itemIds?: string[]) {
    if (!canStart.value || !session.value) return;
    const selectedIds = itemIds?.length ? itemIds : activeItems.value.map((item) => item.id);
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    items.value = items.value.map((item) =>
      selected.has(item.id) ? compressionWorkspaceItem(item) : item
    );
    phase.value = "running";
    summary.value = null;
    hasSaved.value = false;
    errorMessage.value = "";
    currentItem.value = "";
    completedCount.value = 0;
    progressTotal.value = selectedIds.length;
    try {
      summary.value = await runCompression(
        session.value.sessionId,
        selectedIds,
        settings.value,
        handleProgress
      );
      phase.value = "completed";
    } catch (error) {
      phase.value = "ready";
      errorMessage.value = error instanceof Error ? error.message : String(error);
    }
  }

  async function save(outputRoot: string): Promise<CompressionSaveSummary | null> {
    if (!outputRoot || !canSave.value || !session.value) return null;
    phase.value = "saving";
    errorMessage.value = "";
    try {
      const result = await saveCompressionResults(
        session.value.sessionId,
        successfulIds.value,
        outputRoot,
        settings.value
      );
      hasSaved.value = result.saved > 0;
      items.value = applyCompressionSave(items.value, result);
      if (result.failed) errorMessage.value = `${result.failed} 个结果保存失败，请查看结果列表。`;
      return result;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      return null;
    } finally {
      phase.value = "completed";
    }
  }

  async function cancel() {
    if (phase.value !== "running" || !session.value) return;
    phase.value = "cancelling";
    try {
      await cancelCompression(session.value.sessionId);
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : String(error);
      phase.value = "running";
    }
  }

  onBeforeUnmount(() => {
    const sessionId = session.value?.sessionId;
    if (sessionId) void releaseCompression(sessionId).catch(() => undefined);
  });

  return {
    phase,
    session,
    items,
    settings,
    summary,
    hasSaved,
    errorMessage,
    currentItem,
    completedCount,
    progressTotal,
    activeItems,
    canStart,
    canSave,
    isRunning,
    isBusy,
    progressPercent,
    prepare,
    removeItem,
    clear,
    retryFailed,
    start,
    save,
    cancel
  };
}
