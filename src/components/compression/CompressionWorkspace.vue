<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import CompressionSettingsDialog from "./CompressionSettingsDialog.vue";
import CompressionSettingsPanel from "./CompressionSettingsPanel.vue";
import CompressionSaveToast from "./CompressionSaveToast.vue";
import CompressionSourceList from "./CompressionSourceList.vue";
import {
  compressionSaveToastMessage,
  useImageCompression
} from "@/composables/useImageCompression";
import {
  chooseCompressionFiles,
  chooseCompressionFolder,
  chooseCompressionOutputFolder,
  onCompressionFileDrop
} from "@/services/imageCompression";

const compression = useImageCompression();
const selecting = shallowRef(false);
const showSettings = shallowRef(false);
const saveToastMessage = shallowRef("");
let unlistenDrop: UnlistenFn | undefined;
let saveToastTimer: number | undefined;

const failedIds = computed(() =>
  compression.items.value.filter((item) => item.status === "failed").map((item) => item.id)
);

onMounted(async () => {
  unlistenDrop = await onCompressionFileDrop((paths) => {
    if (!compression.isBusy.value && paths.length) void compression.prepare("files", paths);
  });
});

onBeforeUnmount(() => {
  unlistenDrop?.();
  if (saveToastTimer) window.clearTimeout(saveToastTimer);
});

function dismissSaveToast() {
  saveToastMessage.value = "";
  if (saveToastTimer) window.clearTimeout(saveToastTimer);
  saveToastTimer = undefined;
}

function showSaveToast(message: string) {
  dismissSaveToast();
  if (!message) return;
  saveToastMessage.value = message;
  saveToastTimer = window.setTimeout(dismissSaveToast, 2600);
}

async function addImages() {
  if (selecting.value || compression.isBusy.value) return;
  selecting.value = true;
  try {
    const paths = await chooseCompressionFiles();
    if (paths.length) await compression.prepare("files", paths);
  } finally {
    selecting.value = false;
  }
}

async function selectFolder() {
  if (selecting.value || compression.isBusy.value) return;
  selecting.value = true;
  try {
    const path = await chooseCompressionFolder();
    if (path) await compression.prepare("folder", [path]);
  } finally {
    selecting.value = false;
  }
}

async function saveResults() {
  const path = await chooseCompressionOutputFolder(
    compression.session.value?.inputMode ?? "files"
  );
  if (!path) return;
  const result = await compression.save(path);
  if (result) showSaveToast(compressionSaveToastMessage(result));
}

async function retryFailed() {
  const ids = failedIds.value;
  if (!ids.length) return;
  compression.retryFailed();
  await compression.start(ids);
}
</script>

<template>
  <div class="compression-workspace">
    <CompressionSourceList
      :items="compression.items.value"
      :session-id="compression.session.value?.sessionId"
      :preparing="compression.phase.value === 'preparing' || selecting"
      :locked="compression.isBusy.value"
      @add="addImages"
      @select-folder="selectFolder"
      @remove="compression.removeItem"
      @clear="compression.clear"
      @retry="retryFailed"
    />
    <CompressionSettingsPanel
      :items="compression.items.value"
      :rejected-count="compression.session.value?.rejectedCount"
      :can-start="compression.canStart.value"
      :can-save="compression.canSave.value"
      :running="compression.isRunning.value"
      :cancelling="compression.phase.value === 'cancelling'"
      :saving="compression.phase.value === 'saving'"
      :current-item="compression.currentItem.value"
      :progress-percent="compression.progressPercent.value"
      :completed-count="compression.completedCount.value"
      :progress-total="compression.progressTotal.value"
      :summary="compression.summary.value"
      :has-saved="compression.hasSaved.value"
      @open-settings="showSettings = true"
      @save="saveResults"
      @start="compression.start()"
      @cancel="compression.cancel"
    />
    <CompressionSettingsDialog
      v-if="showSettings"
      v-model="compression.settings.value"
      @close="showSettings = false"
    />
    <CompressionSaveToast
      v-if="saveToastMessage"
      :message="saveToastMessage"
      @dismiss="dismissSaveToast"
    />
    <p v-if="compression.errorMessage.value" class="workspace-error" role="alert">
      {{ compression.errorMessage.value }}
    </p>
    <div class="sr-progress" aria-live="polite" aria-atomic="true">
      <span v-if="compression.isRunning.value">
        正在压缩 {{ compression.currentItem.value }}，已完成 {{ compression.completedCount.value }} / {{ compression.progressTotal.value }}
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.compression-workspace {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  overflow: hidden;
}

.workspace-error {
  position: absolute;
  z-index: 6;
  right: 356px;
  bottom: 16px;
  max-width: min(520px, calc(100% - 390px));
  margin: 0;
  padding: 9px 12px;
  border: 1px solid rgba(239, 125, 136, 0.44);
  border-radius: 7px;
  color: #ffb1b8;
  background: #251217;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.34);
  font-size: 11px;
}

.sr-progress {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 900px) {
  .compression-workspace {
    height: auto;
    min-height: calc(100vh - 48px);
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(520px, calc(100vh - 48px)) auto;
    overflow: visible;
  }

  .workspace-error {
    position: fixed;
    right: 14px;
    bottom: 14px;
    left: 14px;
    max-width: none;
  }
}
</style>
