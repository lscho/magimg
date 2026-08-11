import { computed, onBeforeUnmount, shallowRef } from "vue";
import { isDesktopApp } from "@/services/desktop";
import {
  CUTOUT_MODEL,
  downloadModel,
  getModelStatus
} from "@/services/cutoutModelManager";
import {
  DEFAULT_SMART_SELECTION_THRESHOLD,
  detectSmartSelections,
  normalizeSmartSelectionThreshold
} from "@/services/smartSelection";
import type { CutoutModelStatus, CutoutSelection } from "@/types";

export type SmartSelectionPhase = "idle" | "checking" | "downloading" | "detecting";

const sharedThreshold = shallowRef(DEFAULT_SMART_SELECTION_THRESHOLD);

export function useSmartSelection() {
  const phase = shallowRef<SmartSelectionPhase>("checking");
  const resourceStatus = shallowRef<CutoutModelStatus>("missing");
  const progress = shallowRef(0);
  const error = shallowRef("");
  const controller = shallowRef<AbortController | null>(null);
  const available = isDesktopApp();
  const busy = computed(() => phase.value !== "idle");

  function setThreshold(value: number) {
    sharedThreshold.value = normalizeSmartSelectionThreshold(value);
  }

  async function refreshStatus() {
    if (!available) {
      resourceStatus.value = "missing";
      phase.value = "idle";
      return;
    }
    phase.value = "checking";
    resourceStatus.value = await getModelStatus(CUTOUT_MODEL);
    phase.value = "idle";
  }

  async function install() {
    if (!available || busy.value) return false;
    const abortController = new AbortController();
    controller.value = abortController;
    phase.value = "downloading";
    resourceStatus.value = "downloading";
    progress.value = 0;
    error.value = "";
    try {
      await downloadModel(CUTOUT_MODEL, next => {
        progress.value = Math.round(next.receivedBytes / Math.max(1, next.totalBytes) * 100);
      }, abortController.signal);
      resourceStatus.value = "ready";
      progress.value = 100;
      return true;
    } catch (exception) {
      resourceStatus.value = abortController.signal.aborted ? "missing" : "error";
      error.value = exception instanceof Error ? exception.message : "SAM 2 模型安装失败。";
      return false;
    } finally {
      controller.value = null;
      phase.value = "idle";
    }
  }

  async function detect(
    image: { source: CanvasImageSource; width: number; height: number }
  ): Promise<CutoutSelection[] | null> {
    if (!available || busy.value) return null;
    error.value = "";
    if (resourceStatus.value !== "ready") {
      const size = (CUTOUT_MODEL.sizeBytes / 1024 / 1024).toFixed(1);
      if (!window.confirm(`智能框选需要下载约 ${size} MiB 的 SAM 2 本地模型，是否继续？`)) return null;
      if (!await install()) return null;
    }
    const abortController = new AbortController();
    controller.value = abortController;
    phase.value = "detecting";
    try {
      return await detectSmartSelections(
        image.source,
        image.width,
        image.height,
        { minPredictedIou: sharedThreshold.value },
        abortController.signal
      );
    } catch (exception) {
      error.value = abortController.signal.aborted
        ? "智能框选已取消。"
        : exception instanceof Error ? exception.message : "智能框选失败，请稍后重试。";
      return null;
    } finally {
      if (controller.value === abortController) controller.value = null;
      phase.value = "idle";
    }
  }

  function cancel() {
    controller.value?.abort();
  }

  void refreshStatus();
  onBeforeUnmount(() => {
    cancel();
  });

  return {
    available,
    phase,
    resourceStatus,
    progress,
    error,
    busy,
    threshold: sharedThreshold,
    setThreshold,
    refreshStatus,
    install,
    detect,
    cancel
  };
}
