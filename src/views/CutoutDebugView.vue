<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import CutoutWorkspace from "@/components/cutout/CutoutWorkspace.vue";
import CutoutDebugPanel from "@/components/cutout/CutoutDebugPanel.vue";
import { useCutoutDebugPipeline, type CutoutDebugSegmenter, type CutoutDebugRepairMode } from "@/composables/useCutoutDebugPipeline";
import { selectedImageFileFromFile } from "@/services/desktop";
import { cloneCutoutSelections } from "@/services/cutoutSelectionModel";
import type { CutoutSelection } from "@/types";

const pipeline = useCutoutDebugPipeline();
const {
  stages,
  running,
  error,
  totalDuration,
  resources,
  localModelsSupported,
  run,
  cancel,
  reset
} = pipeline;

const selectedFile = shallowRef<{ blob: Blob; mimeType: string } | null>(null);
const sessionKey = shallowRef(0);
const selections = shallowRef<CutoutSelection[]>([]);
const imageSource = shallowRef<{ source: CanvasImageSource; width: number; height: number } | null>(null);
const segmenter = ref<CutoutDebugSegmenter>("birefnet");
const segmenterBySelection = ref<Record<string, CutoutDebugSegmenter>>({});
const repairMode = ref<CutoutDebugRepairMode>("auto");
const importing = shallowRef(false);
const preconditionError = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

const source = computed(() => selectedFile.value);

function onSegmenterChange(next: CutoutDebugSegmenter) {
  segmenter.value = next;
  // 切换默认模型会改变画布交互语义，重挂载工作区并清空选区与逐选区覆盖。
  selections.value = [];
  segmenterBySelection.value = {};
  imageSource.value = null;
  sessionKey.value += 1;
}

function onRepairChange(next: CutoutDebugRepairMode) {
  repairMode.value = next;
}

async function handleFile(file: File) {
  if (importing.value) return;
  importing.value = true;
  try {
    const selected = selectedImageFileFromFile(file);
    selectedFile.value = { blob: selected.file, mimeType: selected.file.type || "image/png" };
    selections.value = [];
    imageSource.value = null;
    sessionKey.value += 1;
    preconditionError.value = "";
  } catch (exception) {
    preconditionError.value = exception instanceof Error ? exception.message : "图片读取失败。";
  } finally {
    importing.value = false;
  }
}

function onImportClick() {
  fileInput.value?.click();
}

function onFileInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void handleFile(file);
  input.value = "";
}

function handleReady(payload: { source: CanvasImageSource; width: number; height: number }) {
  imageSource.value = payload;
}

function handleSelectionsChange(next: CutoutSelection[]) {
  selections.value = cloneCutoutSelections(next);
  // 清理已不存在的选区覆盖，避免悬空 id。
  const ids = new Set(next.map((item) => item.id));
  const pruned: Record<string, CutoutDebugSegmenter> = {};
  for (const [id, model] of Object.entries(segmenterBySelection.value)) {
    if (ids.has(id)) pruned[id] = model;
  }
  segmenterBySelection.value = pruned;
}

function runPipeline() {
  if (!imageSource.value) {
    preconditionError.value = "请先导入图片并等待画布就绪。";
    return;
  }
  preconditionError.value = "";
  void run({
    image: imageSource.value.source,
    imageWidth: imageSource.value.width,
    imageHeight: imageSource.value.height,
    selections: selections.value,
    segmenter: segmenter.value,
    segmenterBySelection: segmenterBySelection.value,
    repairMode: repairMode.value
  });
}
</script>

<template>
  <section class="page-view debug-view">
    <div class="debug-layout">
      <CutoutWorkspace
        :key="`${sessionKey}-${segmenter}`"
        :source="source"
        :initial-selections="selections"
        :importing="importing"
        :locked="running"
        :plain-selections="true"
        :mode="segmenter === 'sam' ? 'auto-layer' : 'cutout'"
        @ready="handleReady"
        @selections-change="handleSelectionsChange"
        @import="onImportClick"
        @drop-file="handleFile"
      />
      <CutoutDebugPanel
        :stages="stages"
        :running="running"
        :error="error || preconditionError"
        :total-duration="totalDuration"
        :resources="resources"
        :segmenter="segmenter"
        :segmenter-by-selection="segmenterBySelection"
        :repair-mode="repairMode"
        :local-models-supported="localModelsSupported"
        :selections="selections"
        @update:segmenter="onSegmenterChange"
        @update:segmenter-by-selection="segmenterBySelection = $event"
        @update:repair-mode="onRepairChange"
        @run="runPipeline"
        @cancel="cancel"
        @reset="reset"
        @import="onImportClick"
      />
    </div>
    <input
      ref="fileInput"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      class="debug-file-input"
      @change="onFileInput"
    />
  </section>
</template>

<style scoped lang="scss">
.debug-view {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.debug-layout {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(360px, 32vw, 480px);
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
}

.debug-file-input {
  display: none;
}

@media (max-width: 1024px) {
  .debug-layout {
    grid-template-columns: minmax(0, 1fr) 360px;
  }
}

@media (max-width: 820px) {
  .debug-layout {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) auto;
    overflow: auto;
  }
}
</style>
