import type { FabricRuntime } from "./fabricRuntime";

let fabricRuntimePromise: Promise<FabricRuntime> | null = null;

/** Fabric 体积较大，仅在进入编辑器后加载；失败时清空缓存以允许用户重试。 */
export function preloadImageEditorRuntime(): Promise<FabricRuntime> {
  if (!fabricRuntimePromise) {
    fabricRuntimePromise = import("./fabricRuntime")
      .then(({ fabricRuntime }) => fabricRuntime)
      .catch((exception) => {
        fabricRuntimePromise = null;
        throw exception;
      });
  }
  return fabricRuntimePromise;
}
