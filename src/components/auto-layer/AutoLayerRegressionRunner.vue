<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCutoutInference } from "@/composables/useCutoutInference";
import { runAutoLayerRegression } from "@/services/autoLayerRegression";
import { parseAutoLayerRegressionCase } from "@/services/autoLayerRegressionQuality";
import { useAppStore } from "@/stores/app";

const app = useAppStore();
const inference = useCutoutInference();
const status = shallowRef("准备自动分层回归测试");
const failure = shallowRef("");
const collectorUrl = import.meta.env.VITE_AUTO_LAYER_REGRESSION_URL?.replace(/\/+$/u, "") ?? "";
const recordId = import.meta.env.VITE_AUTO_LAYER_REGRESSION_RECORD_ID?.trim() || undefined;
const cloud = import.meta.env.VITE_AUTO_LAYER_REGRESSION_CLOUD === "true";
const forceCloudInput = import.meta.env.VITE_AUTO_LAYER_REGRESSION_FORCE_CLOUD_INPUT === "true";
const skipQualityGate = import.meta.env.VITE_AUTO_LAYER_REGRESSION_SKIP_QUALITY_GATE === "true";
const runId = import.meta.env.VITE_AUTO_LAYER_REGRESSION_RUN_ID?.trim() || "";
const qualityCaseJson = import.meta.env.VITE_AUTO_LAYER_REGRESSION_CASE || "";
const progressLabel = computed(() => {
  const progress = inference.progress.value;
  return progress ? `${progress.stage} ${progress.current}/${progress.total}` : "";
});

function reportStatus(message: string) {
  status.value = message;
  void fetch(`${collectorUrl}/status`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message })
  }).catch(() => undefined);
}

onMounted(async () => {
  try {
    if (!collectorUrl) throw new Error("自动分层回归收集地址为空。");
    if (!runId) throw new Error("自动分层回归运行 ID 为空。");
    const qualityCase = parseAutoLayerRegressionCase(JSON.parse(qualityCaseJson));
    await runAutoLayerRegression({
      collectorUrl,
      recordId,
      runId,
      qualityCase,
      cloud,
      forceCloudInput,
      skipQualityGate,
      inference,
      app,
      onStatus: reportStatus
    });
  } catch (error) {
    failure.value = error instanceof Error ? error.message : String(error);
  } finally {
    window.setTimeout(() => { void getCurrentWindow().close(); }, failure.value ? 1800 : 250);
  }
});
</script>

<template>
  <main class="regression-runner">
    <section aria-live="polite">
      <h1>自动分层回归</h1>
      <p>{{ failure || status }}</p>
      <p v-if="progressLabel">{{ progressLabel }}</p>
      <p>{{ cloud ? "本次包含一次云端修复" : forceCloudInput ? "本次只生成云端输入" : "本次仅运行本地模型" }}</p>
    </section>
  </main>
</template>

<style scoped>
.regression-runner {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px;
  color: var(--text);
  background: var(--field);
}

.regression-runner section {
  width: min(520px, 100%);
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}

.regression-runner h1 {
  margin: 0 0 16px;
  font-size: 20px;
  letter-spacing: 0;
}

.regression-runner p {
  margin: 8px 0 0;
  color: var(--muted);
}
</style>
