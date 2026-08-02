import { computed, onBeforeUnmount, shallowRef } from "vue";
import {
  cancelCompression,
  prepareCompression,
  releaseCompression,
  runCompression
} from "@/services/imageCompression";
import type {
  CompressionInputMode,
  CompressionItemStatus,
  CompressionPreparedSession,
  CompressionProgressEvent,
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
}

export type CompressionPhase =
  | "idle"
  | "preparing"
  | "ready"
  | "running"
  | "cancelling"
  | "completed";

export const DEFAULT_COMPRESSION_SETTINGS: CompressionSettings = {
  pngLevel: "balanced",
  jpegQuality: 82,
  jpegProgressive: true,
  webpMode: "lossy",
  webpQuality: 82,
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
    message: ""
  };
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
  const outputDirectory = shallowRef("");
  const summary = shallowRef<CompressionSummary | null>(null);
  const errorMessage = shallowRef("");
  const currentItem = shallowRef("");
  const completedCount = shallowRef(0);
  const progressTotal = shallowRef(0);

  const activeItems = computed(() => items.value.filter((item) => item.status !== "cancelled"));
  const canStart = computed(
    () =>
      Boolean(session.value && outputDirectory.value && activeItems.value.length) &&
      phase.value !== "preparing" &&
      phase.value !== "running" &&
      phase.value !== "cancelling"
  );
  const isRunning = computed(() => phase.value === "running" || phase.value === "cancelling");
  const progressPercent = computed(() =>
    progressTotal.value > 0 ? Math.round((completedCount.value / progressTotal.value) * 100) : 0
  );

  async function releaseCurrent() {
    const sessionId = session.value?.sessionId;
    session.value = null;
    if (sessionId) await releaseCompression(sessionId).catch(() => undefined);
  }

  async function prepare(inputMode: CompressionInputMode, paths: string[]) {
    if (!paths.length || isRunning.value) return;
    phase.value = "preparing";
    errorMessage.value = "";
    summary.value = null;
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
    if (isRunning.value) return;
    items.value = items.value.filter((item) => item.id !== itemId);
    summary.value = null;
    if (!items.value.length) void clear();
  }

  async function clear() {
    if (isRunning.value) return;
    await releaseCurrent();
    items.value = [];
    summary.value = null;
    currentItem.value = "";
    completedCount.value = 0;
    progressTotal.value = 0;
    errorMessage.value = "";
    phase.value = "idle";
  }

  function retryFailed() {
    if (isRunning.value) return;
    items.value = items.value.map((item) =>
      item.status === "failed" ? compressionWorkspaceItem(item) : item
    );
    summary.value = null;
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
    errorMessage.value = "";
    currentItem.value = "";
    completedCount.value = 0;
    progressTotal.value = selectedIds.length;
    try {
      summary.value = await runCompression(
        session.value.sessionId,
        selectedIds,
        outputDirectory.value,
        settings.value,
        handleProgress
      );
      phase.value = "completed";
    } catch (error) {
      phase.value = "ready";
      errorMessage.value = error instanceof Error ? error.message : String(error);
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
    outputDirectory,
    summary,
    errorMessage,
    currentItem,
    completedCount,
    progressTotal,
    activeItems,
    canStart,
    isRunning,
    progressPercent,
    prepare,
    removeItem,
    clear,
    retryFailed,
    start,
    cancel
  };
}
