import { computed, onScopeDispose, readonly, shallowRef } from "vue";
import {
  checkDesktopUpdate,
  type DesktopUpdateHandle,
  type DesktopUpdateInfo,
  type DesktopUpdateProgress
} from "@/services/updater";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "error";

function messageFromError(exception: unknown, fallback: string) {
  if (exception instanceof Error && exception.message.trim()) return exception.message.trim();
  if (typeof exception === "string" && exception.trim()) return exception.trim();
  return fallback;
}

export function useAppUpdater() {
  const status = shallowRef<AppUpdateStatus>("idle");
  const update = shallowRef<DesktopUpdateHandle | null>(null);
  const downloadedBytes = shallowRef(0);
  const totalBytes = shallowRef<number | null>(null);
  const errorMessage = shallowRef("");
  const installed = shallowRef(false);
  const isPromptVisible = shallowRef(false);
  let checked = false;

  const info = computed<DesktopUpdateInfo | null>(() => update.value?.info ?? null);
  const isAvailable = computed(() => Boolean(update.value));
  const isBusy = computed(() => ["downloading", "installing", "restarting"].includes(status.value));
  const canDismiss = computed(() =>
    Boolean(update.value && !update.value.info.isForceUpdate && !isBusy.value && !installed.value)
  );
  const progressPercent = computed(() => {
    if (!totalBytes.value) return null;
    return Math.min(100, Math.round((downloadedBytes.value / totalBytes.value) * 100));
  });

  async function checkForUpdates() {
    if (checked) return;
    checked = true;
    status.value = "checking";
    try {
      update.value = await checkDesktopUpdate();
      status.value = update.value ? "available" : "idle";
      isPromptVisible.value = update.value?.info.isForceUpdate === true;
    } catch {
      status.value = "idle";
    }
  }

  function openPrompt() {
    if (update.value) isPromptVisible.value = true;
  }

  function dismissPrompt() {
    if (canDismiss.value) isPromptVisible.value = false;
  }

  function handleProgress(progress: DesktopUpdateProgress) {
    status.value = progress.phase;
    downloadedBytes.value = progress.downloadedBytes;
    totalBytes.value = progress.totalBytes;
  }

  async function installAndRestart() {
    if (!update.value || isBusy.value) return;
    errorMessage.value = "";
    installed.value = false;
    downloadedBytes.value = 0;
    totalBytes.value = update.value.info.fileSize;
    status.value = "downloading";

    try {
      await update.value.install(handleProgress);
      installed.value = true;
      status.value = "restarting";
      await update.value.restart();
    } catch (exception) {
      status.value = "error";
      errorMessage.value = installed.value
        ? messageFromError(exception, "更新已安装，但客户端未能自动重启。")
        : messageFromError(exception, "更新安装失败，请检查网络后重试。");
    }
  }

  async function retryRestart() {
    if (!update.value || !installed.value) return;
    errorMessage.value = "";
    status.value = "restarting";
    try {
      await update.value.restart();
    } catch (exception) {
      status.value = "error";
      errorMessage.value = messageFromError(exception, "客户端未能自动重启，请手动关闭后重新打开。");
    }
  }

  onScopeDispose(() => {
    void update.value?.close().catch(() => undefined);
  });

  return {
    status: readonly(status),
    info,
    isAvailable,
    isPromptVisible: readonly(isPromptVisible),
    isBusy,
    canDismiss,
    downloadedBytes: readonly(downloadedBytes),
    totalBytes: readonly(totalBytes),
    progressPercent,
    errorMessage: readonly(errorMessage),
    installed: readonly(installed),
    checkForUpdates,
    openPrompt,
    dismissPrompt,
    installAndRestart,
    retryRestart
  };
}
