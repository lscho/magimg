<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import {
  CircleAlert,
  CircleCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  ImagePlus,
  Wand2
} from "lucide-vue-next";
import HistorySelectionBar from "@/components/HistorySelectionBar.vue";
import HistoryTaskCard from "@/components/HistoryTaskCard.vue";
import HistoryTaskContextMenu from "@/components/HistoryTaskContextMenu.vue";
import {
  copyRemoteImageToClipboard,
  remoteImageToSelectedFile,
  saveRemoteImageAs,
  saveRemoteImagesToDirectory
} from "@/services/desktop";
import { useAppStore } from "@/stores/app";
import type { GenerationMode, GenerationRecord, SelectedImageFile } from "@/types";

const app = useAppStore();
const router = useRouter();
const pageSize = 12;
const activeMode = shallowRef<GenerationMode>("text-to-image");
const currentPage = shallowRef(1);
const selectedGenerationIds = shallowRef<Set<string>>(new Set());
const downloading = shallowRef(false);
const deleting = shallowRef(false);
const actionMessage = shallowRef("");
const actionError = shallowRef("");
const contextMenuTarget = shallowRef<GenerationRecord | null>(null);
const contextMenuX = shallowRef(0);
const contextMenuY = shallowRef(0);

const filteredHistory = computed(() =>
  app.visibleHistory.filter((record) => record.mode === activeMode.value)
);
const totalPages = computed(() => Math.max(1, Math.ceil(filteredHistory.value.length / pageSize)));
const paginatedHistory = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return filteredHistory.value.slice(start, start + pageSize);
});
const pageNumbers = computed(() => {
  const visibleCount = Math.min(5, totalPages.value);
  const start = Math.max(1, Math.min(currentPage.value - 2, totalPages.value - visibleCount + 1));
  return Array.from({ length: visibleCount }, (_, index) => start + index);
});
const rangeLabel = computed(() => {
  if (!filteredHistory.value.length) return "0 项任务";
  const start = (currentPage.value - 1) * pageSize + 1;
  const end = Math.min(currentPage.value * pageSize, filteredHistory.value.length);
  return `${start}-${end} / ${filteredHistory.value.length} 项任务`;
});
const selectedRecords = computed(() => {
  const selectedIds = selectedGenerationIds.value;
  return app.visibleHistory.filter((record) => selectedIds.has(record.generationId));
});
const selectedCount = computed(() => selectedRecords.value.length);
const canDownloadSelection = computed(
  () =>
    selectedRecords.value.length > 0 &&
    selectedRecords.value.every((record) => record.images.length > 0)
);
const contextMenuHasImage = computed(() => Boolean(contextMenuTarget.value?.images[0]));

watch(activeMode, () => {
  currentPage.value = 1;
  clearSelection();
});

watch(totalPages, (pageCount) => {
  currentPage.value = Math.min(currentPage.value, pageCount);
});

watch(
  () => app.visibleHistory.map((record) => record.generationId),
  (visibleIds) => {
    const visibleIdSet = new Set(visibleIds);
    const nextSelection = new Set(
      [...selectedGenerationIds.value].filter((id) => visibleIdSet.has(id))
    );
    if (nextSelection.size !== selectedGenerationIds.value.size) {
      selectedGenerationIds.value = nextSelection;
    }
  }
);

function setPage(page: number) {
  currentPage.value = Math.min(totalPages.value, Math.max(1, page));
}

function toggleSelection(generationId: string) {
  const nextSelection = new Set(selectedGenerationIds.value);
  if (nextSelection.has(generationId)) nextSelection.delete(generationId);
  else nextSelection.add(generationId);
  selectedGenerationIds.value = nextSelection;
  actionMessage.value = "";
  actionError.value = "";
}

function clearSelection() {
  selectedGenerationIds.value = new Set();
  actionMessage.value = "";
  actionError.value = "";
}

function openTaskMenu(record: GenerationRecord, position: { x: number; y: number }) {
  contextMenuX.value = Math.max(8, Math.min(position.x, window.innerWidth - 176));
  contextMenuY.value = Math.max(8, Math.min(position.y, window.innerHeight - 176));
  contextMenuTarget.value = record;
  actionMessage.value = "";
  actionError.value = "";
}

function closeTaskMenu() {
  contextMenuTarget.value = null;
}

async function restoredReferenceImage(record: GenerationRecord): Promise<SelectedImageFile | null> {
  if (record.mode !== "image-to-image") return null;
  if (!record.inputImage) {
    throw new Error("该图生图任务缺少可恢复的参考图。");
  }

  return await remoteImageToSelectedFile(
    record.inputImage.remoteUrl,
    `huanhua-${record.generationId}-reference`,
    record.inputImage.mimeType
  );
}

async function openContextTask() {
  const selectedRecord = contextMenuTarget.value;
  closeTaskMenu();
  if (!selectedRecord) return;

  actionMessage.value = "";
  actionError.value = "";
  try {
    const record = await app.resolveHistoryTask(selectedRecord);
    const restoredReference = await restoredReferenceImage(record);
    app.queueHistoryWorkspace(record, restoredReference);
    await router.push({
      name: "generate",
      params: { mode: record.mode }
    });
  } catch (exception) {
    app.discardHistoryWorkspace();
    actionError.value = exception instanceof Error
      ? exception.message
      : "任务打开失败，请稍后重试。";
  }
}

function takeContextImage() {
  const record = contextMenuTarget.value;
  const image = record?.images[0];
  closeTaskMenu();
  return record && image ? { record, image } : null;
}

async function copyContextImage() {
  const target = takeContextImage();
  if (!target) return;

  actionMessage.value = "";
  actionError.value = "";
  try {
    await copyRemoteImageToClipboard(target.image.remoteUrl, target.image.mimeType);
    actionMessage.value = "图片已复制";
  } catch (exception) {
    actionError.value = exception instanceof Error
      ? exception.message
      : "图片复制失败，请稍后重试。";
  }
}

async function downloadContextImage() {
  const target = takeContextImage();
  if (!target) return;

  actionMessage.value = "";
  actionError.value = "";
  try {
    const savedPath = await saveRemoteImageAs(
      target.image.remoteUrl,
      `huanhua-${target.record.generationId}`,
      target.image.mimeType
    );
    if (savedPath) actionMessage.value = "图片已保存";
  } catch (exception) {
    actionError.value = exception instanceof Error
      ? exception.message
      : "图片保存失败，请稍后重试。";
  }
}

async function useContextImageAsReference() {
  const target = takeContextImage();
  if (!target) return;

  actionMessage.value = "";
  actionError.value = "";
  try {
    const referenceImage = await remoteImageToSelectedFile(
      target.image.remoteUrl,
      `huanhua-${target.record.generationId}`,
      target.image.mimeType
    );
    app.queueReferenceImage(referenceImage);
    await router.push({
      name: "generate",
      params: { mode: "image-to-image" }
    });
  } catch (exception) {
    app.discardReferenceImage();
    actionError.value = exception instanceof Error
      ? exception.message
      : "图片读取失败，请稍后重试。";
  }
}

async function deleteSelected() {
  if (!selectedRecords.value.length) return;
  const confirmed = window.confirm(`确定从创作历史中删除所选 ${selectedCount.value} 项任务吗？`);
  if (!confirmed) return;

  deleting.value = true;
  actionError.value = "";
  try {
    await app.removeHistory(selectedRecords.value.map((record) => record.generationId));
    clearSelection();
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "删除失败，请稍后重试。";
  } finally {
    deleting.value = false;
  }
}

async function downloadSelected() {
  if (!canDownloadSelection.value) return;

  const downloads = selectedRecords.value.flatMap((record) =>
    record.images.map((image, index) => ({
      image,
      suggestedName: `huanhua-${record.generationId}${record.images.length > 1 ? `-${index + 1}` : ""}`
    }))
  );
  if (!downloads.length) return;

  downloading.value = true;
  actionMessage.value = "";
  actionError.value = "";
  try {
    const result = await saveRemoteImagesToDirectory(downloads);
    if (result.cancelled) return;
    actionMessage.value = result.directory
      ? `已保存 ${result.savedCount} 张图片`
      : `已下载 ${result.savedCount} 张图片`;
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "批量下载失败，请稍后重试。";
  } finally {
    downloading.value = false;
  }
}
</script>

<template>
  <section class="page-view history-view" :class="{ 'has-selection': selectedCount }">
    <div class="page-heading history-page-heading">
      <div class="history-heading-copy">
        <span class="section-kicker">CREATION LOG</span>
        <h1>创作历史</h1>
        <p>集中管理生成任务与历史作品。</p>
      </div>

      <div class="history-mode-switch" role="group" aria-label="历史类型">
        <button
          type="button"
          :class="{ active: activeMode === 'text-to-image' }"
          :aria-pressed="activeMode === 'text-to-image'"
          @click="activeMode = 'text-to-image'"
        >
          <Wand2 :size="15" /> 文生图
        </button>
        <button
          type="button"
          :class="{ active: activeMode === 'image-to-image' }"
          :aria-pressed="activeMode === 'image-to-image'"
          @click="activeMode = 'image-to-image'"
        >
          <ImagePlus :size="15" /> 图生图
        </button>
      </div>
    </div>

    <div class="history-toolbar">
      <span>{{ activeMode === "text-to-image" ? "文生图任务" : "图生图任务" }}</span>
      <span>{{ rangeLabel }}</span>
    </div>

    <div v-if="paginatedHistory.length" class="history-grid">
      <HistoryTaskCard
        v-for="record in paginatedHistory"
        :key="record.id"
        :record="record"
        :selected="selectedGenerationIds.has(record.generationId)"
        @toggle="toggleSelection"
        @open-menu="openTaskMenu(record, $event)"
      />
    </div>
    <div v-else class="empty-state full">
      <div class="empty-visual"><Clock3 :size="34" /></div>
      <strong>暂无{{ activeMode === "text-to-image" ? "文生图" : "图生图" }}记录</strong>
      <span>完成对应模式的生成后，任务与作品会自动保存在这里。</span>
    </div>

    <nav v-if="filteredHistory.length > pageSize" class="history-pagination" aria-label="历史记录分页">
      <button
        type="button"
        aria-label="第一页"
        title="第一页"
        :disabled="currentPage === 1"
        @click="setPage(1)"
      >
        <ChevronsLeft :size="15" />
      </button>
      <button
        type="button"
        aria-label="上一页"
        title="上一页"
        :disabled="currentPage === 1"
        @click="setPage(currentPage - 1)"
      >
        <ChevronLeft :size="15" />
      </button>
      <button
        v-for="page in pageNumbers"
        :key="page"
        type="button"
        class="page-number"
        :class="{ active: currentPage === page }"
        :aria-label="`第 ${page} 页`"
        :aria-current="currentPage === page ? 'page' : undefined"
        @click="setPage(page)"
      >
        {{ page }}
      </button>
      <button
        type="button"
        aria-label="下一页"
        title="下一页"
        :disabled="currentPage === totalPages"
        @click="setPage(currentPage + 1)"
      >
        <ChevronRight :size="15" />
      </button>
      <button
        type="button"
        aria-label="最后一页"
        title="最后一页"
        :disabled="currentPage === totalPages"
        @click="setPage(totalPages)"
      >
        <ChevronsRight :size="15" />
      </button>
    </nav>

    <p
      v-if="actionError && !selectedCount"
      class="history-action-feedback is-error"
      role="alert"
    >
      <CircleAlert :size="15" aria-hidden="true" />
      <span>{{ actionError }}</span>
    </p>
    <p
      v-else-if="actionMessage && !selectedCount"
      class="history-action-feedback"
      role="status"
    >
      <CircleCheck :size="15" aria-hidden="true" />
      <span>{{ actionMessage }}</span>
    </p>

    <HistorySelectionBar
      v-if="selectedCount"
      :selected-count="selectedCount"
      :can-download="canDownloadSelection"
      :downloading="downloading"
      :deleting="deleting"
      :message="actionMessage"
      :error="actionError"
      @clear="clearSelection"
      @delete="deleteSelected"
      @download="downloadSelected"
    />

    <HistoryTaskContextMenu
      v-if="contextMenuTarget"
      :x="contextMenuX"
      :y="contextMenuY"
      :has-image="contextMenuHasImage"
      @close="closeTaskMenu"
      @open-task="openContextTask"
      @copy="copyContextImage"
      @download="downloadContextImage"
      @use-as-reference="useContextImageAsReference"
    />
  </section>
</template>

<style scoped lang="scss">
.history-page-heading {
  align-items: center;
  margin-bottom: 0;
  padding-bottom: 18px;
}

.history-heading-copy {
  min-width: 0;
}

.history-mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-subtle);

  button {
    min-width: 108px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border-radius: 5px;
    color: var(--muted);
    background: transparent;
    font-size: 12px;
    font-weight: 600;

    &:hover {
      color: var(--soft);
      background: var(--surface-strong);
    }

    &.active {
      color: var(--accent-strong);
      background: var(--accent-soft);
    }
  }
}

.history-toolbar {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 10px;
  font-weight: 650;

  > span:first-child {
    color: var(--soft);
  }
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: start;
  gap: 12px;
}

.history-view.has-selection {
  padding-bottom: 108px;
}

.history-action-feedback {
  width: fit-content;
  max-width: 100%;
  display: grid;
  grid-template-columns: 15px minmax(0, 1fr);
  align-items: start;
  gap: 7px;
  margin: 16px 0 0;
  padding: 9px 11px;
  border: 1px solid rgba(101, 211, 173, 0.42);
  border-radius: 7px;
  color: var(--success);
  background: rgba(101, 211, 173, 0.08);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;

  &.is-error {
    border-color: rgba(239, 125, 136, 0.42);
    color: var(--danger);
    background: rgba(239, 125, 136, 0.08);
  }
}

.empty-state.full {
  min-height: 390px;
}

.history-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--line);

  button {
    width: 32px;
    height: 32px;
    display: inline-grid;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--muted);
    background: var(--surface);
    font-size: 10px;
    font-weight: 700;

    &:hover:not(:disabled) {
      color: var(--text);
      border-color: var(--line-strong);
      background: var(--surface-subtle);
    }

    &.active {
      color: var(--accent-strong);
      border-color: var(--accent-border);
      background: var(--accent-soft);
    }
  }
}

@media (max-width: 1280px) {
  .history-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .history-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 700px) {
  .history-page-heading {
    display: grid;
    align-items: flex-start;
  }

  .history-mode-switch {
    width: 100%;

    button {
      min-width: 0;
    }
  }
}

@media (max-width: 560px) {
  .history-grid {
    grid-template-columns: 1fr;
  }

  .history-pagination {
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 4px;
  }
}
</style>
