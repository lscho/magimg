// @vitest-environment happy-dom
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/services/apiClient";
import { useAppStore } from "@/stores/app";
import type { AutoLayerTask } from "@/types";

describe("automatic-layer task polling", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns the failed terminal task so a retry can create a fresh task", async () => {
    const pendingTask: AutoLayerTask = {
      id: "auto-1",
      inputAssetId: "asset-1",
      status: "pending",
      cost: 20,
      balance: 80
    };
    const failedTask: AutoLayerTask = {
      ...pendingTask,
      status: "failed",
      balance: 100,
      errorMessage: "背景生成节点失败"
    };
    vi.spyOn(apiClient, "autoLayerTask").mockResolvedValueOnce(failedTask);

    const resultPromise = useAppStore().waitForAutoLayerTask(
      pendingTask,
      new AbortController().signal
    );
    await vi.advanceTimersByTimeAsync(1500);

    await expect(resultPromise).resolves.toEqual(failedTask);
    expect(apiClient.autoLayerTask).toHaveBeenCalledWith("auto-1");
  });
});
