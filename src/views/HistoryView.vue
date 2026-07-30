<script setup lang="ts">
import { computed, nextTick, shallowRef, watch } from "vue";
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
  Scissors,
  Wand2
} from "lucide-vue-next";
import CutoutHistoryTaskCard from "@/components/CutoutHistoryTaskCard.vue";
import CutoutHistoryTaskContextMenu from "@/components/CutoutHistoryTaskContextMenu.vue";
import HistorySelectionBar from "@/components/HistorySelectionBar.vue";
import HistoryTaskCard from "@/components/HistoryTaskCard.vue";
import HistoryTaskContextMenu from "@/components/HistoryTaskContextMenu.vue";
import { stageCutoutHandoff } from "@/services/cutoutHandoff";
import {
  copyRemoteImageToClipboard,
  copyTextToClipboard,
  remoteImageToSelectedFile,
  saveImageBlobsToDirectory,
  saveRemoteImageAs,
  saveRemoteImagesToDirectory
} from "@/services/desktop";
import { useAppStore } from "@/stores/app";
import type {
  CutoutHistoryRecord,
  GenerationMode,
  GenerationRecord,
  SelectedImageFile
} from "@/types";

type HistoryTab = GenerationMode | "cutout";
const historyTabs: HistoryTab[] = ["text-to-image", "image-to-image", "cutout"];

const app = useAppStore();
const router = useRouter();
const pageSize = 12;
const activeTab = shallowRef<HistoryTab>("text-to-image");
const currentPage = shallowRef(1);
const selectedTaskIds = shallowRef<Set<string>>(new Set());
const downloading = shallowRef(false);
const deleting = shallowRef(false);
const actionMessage = shallowRef("");
const actionError = shallowRef("");
const contextMenuTarget = shallowRef<GenerationRecord | null>(null);
const cutoutContextMenuTarget = shallowRef<CutoutHistoryRecord | null>(null);
const contextMenuX = shallowRef(0);
const contextMenuY = shallowRef(0);

const filteredGenerationHistory = computed(() => {
  if (activeTab.value === "cutout") return [];
  return app.visibleHistory.filter((record) => record.mode === activeTab.value);
});
const filteredCutoutHistory = computed(() =>
  activeTab.value === "cutout" ? app.cutoutHistory : []
);
const totalItems = computed(() =>
  activeTab.value === "cutout"
    ? filteredCutoutHistory.value.length
    : filteredGenerationHistory.value.length
);
const totalPages = computed(() => Math.max(1, Math.ceil(totalItems.value / pageSize)));
const paginatedGenerationHistory = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return filteredGenerationHistory.value.slice(start, start + pageSize);
});
const paginatedCutoutHistory = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return filteredCutoutHistory.value.slice(start, start + pageSize);
});
const pageNumbers = computed(() => {
  const visibleCount = Math.min(5, totalPages.value);
  const start = Math.max(1, Math.min(currentPage.value - 2, totalPages.value - visibleCount + 1));
  return Array.from({ length: visibleCount }, (_, index) => start + index);
});
const rangeLabel = computed(() => {
  if (!totalItems.value) return "0 项任务";
  const start = (currentPage.value - 1) * pageSize + 1;
  const end = Math.min(currentPage.value * pageSize, totalItems.value);
  return `${start}-${end} / ${totalItems.value} 项任务`;
});
const selectedGenerationRecords = computed(() => {
  if (activeTab.value === "cutout") return [];
  const selectedIds = selectedTaskIds.value;
  return filteredGenerationHistory.value.filter((record) => selectedIds.has(record.generationId));
});
const selectedCutoutRecords = computed(() => {
  if (activeTab.value !== "cutout") return [];
  const selectedIds = selectedTaskIds.value;
  return app.cutoutHistory.filter((record) => selectedIds.has(record.id));
});
const selectedCount = computed(() =>
  selectedGenerationRecords.value.length + selectedCutoutRecords.value.length
);
const canDownloadSelection = computed(() => {
  if (activeTab.value === "cutout") {
    return selectedCutoutRecords.value.length > 0 &&
      selectedCutoutRecords.value.every((record) => record.assets.length > 0);
  }
  return selectedGenerationRecords.value.length > 0 &&
    selectedGenerationRecords.value.every((record) => record.images.length > 0);
});
const contextMenuHasImage = computed(() => Boolean(contextMenuTarget.value?.images[0]));
const visibleRecordIds = computed(() =>
  activeTab.value === "cutout"
    ? filteredCutoutHistory.value.map((record) => record.id)
    : filteredGenerationHistory.value.map((record) => record.generationId)
);
const activeTabLabel = computed(() => {
  if (activeTab.value === "image-to-image") return "图生图任务";
  if (activeTab.value === "cutout") return "AI 抠图任务";
  return "文生图任务";
});
const activeTabId = computed(() => `history-tab-${activeTab.value}`);

watch(activeTab, () => {
  currentPage.value = 1;
  clearSelection();
  closeTaskMenus();
});

watch(totalPages, (pageCount) => {
  currentPage.value = Math.min(currentPage.value, pageCount);
});

watch(visibleRecordIds, (visibleIds) => {
  const visibleIdSet = new Set(visibleIds);
  const nextSelection = new Set(
    [...selectedTaskIds.value].filter((id) => visibleIdSet.has(id))
  );
  if (nextSelection.size !== selectedTaskIds.value.size) selectedTaskIds.value = nextSelection;
});

function setPage(page: number) {
  currentPage.value = Math.min(totalPages.value, Math.max(1, page));
}

function handleHistoryTabKeydown(event: KeyboardEvent) {
  const currentIndex = historyTabs.indexOf(activeTab.value);
  let nextIndex: number | null = null;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % historyTabs.length;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + historyTabs.length) % historyTabs.length;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = historyTabs.length - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  activeTab.value = historyTabs[nextIndex];
  void nextTick(() => document.getElementById(`history-tab-${activeTab.value}`)?.focus());
}

function toggleSelection(taskId: string) {
  const nextSelection = new Set(selectedTaskIds.value);
  if (nextSelection.has(taskId)) nextSelection.delete(taskId);
  else nextSelection.add(taskId);
  selectedTaskIds.value = nextSelection;
  actionMessage.value = "";
  actionError.value = "";
}

function clearSelection() {
  selectedTaskIds.value = new Set();
  actionMessage.value = "";
  actionError.value = "";
}

function setContextMenuPosition(position: { x: number; y: number }, width = 176, height = 184) {
  contextMenuX.value = Math.max(8, Math.min(position.x, window.innerWidth - width - 8));
  contextMenuY.value = Math.max(8, Math.min(position.y, window.innerHeight - height));
}

function openTaskMenu(record: GenerationRecord, position: { x: number; y: number }) {
  setContextMenuPosition(position);
  cutoutContextMenuTarget.value = null;
  contextMenuTarget.value = record;
  actionMessage.value = "";
  actionError.value = "";
}

function openCutoutTaskMenu(record: CutoutHistoryRecord, position: { x: number; y: number }) {
  setContextMenuPosition(position, 184, 84);
  contextMenuTarget.value = null;
  cutoutContextMenuTarget.value = record;
  actionMessage.value = "";
  actionError.value = "";
}

function closeTaskMenus() {
  contextMenuTarget.value = null;
  cutoutContextMenuTarget.value = null;
}

async function restoredReferenceImage(record: GenerationRecord): Promise<SelectedImageFile | null> {
  if (record.mode !== "image-to-image") return null;
  if (!record.inputImage) throw new Error("该图生图任务缺少可恢复的参考图。");
  return remoteImageToSelectedFile(
    record.inputImage.remoteUrl,
    `huanhua-${record.generationId}-reference`,
    record.inputImage.mimeType
  );
}

async function openContextTask() {
  const selectedRecord = contextMenuTarget.value;
  closeTaskMenus();
  if (!selectedRecord) return;
  actionMessage.value = "";
  actionError.value = "";
  try {
    const record = await app.resolveHistoryTask(selectedRecord);
    const restoredReference = await restoredReferenceImage(record);
    app.queueHistoryWorkspace(record, restoredReference);
    await router.push({ name: "generate", params: { mode: record.mode } });
  } catch (exception) {
    app.discardHistoryWorkspace();
    actionError.value = exception instanceof Error ? exception.message : "任务打开失败，请稍后重试。";
  }
}

function takeContextImage() {
  const record = contextMenuTarget.value;
  const image = record?.images[0];
  closeTaskMenus();
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
    actionError.value = exception instanceof Error ? exception.message : "图片复制失败，请稍后重试。";
  }
}

async function copyPrompt(prompt: string) {
  actionMessage.value = "";
  actionError.value = "";
  try {
    await copyTextToClipboard(prompt);
    actionMessage.value = "提示词已复制";
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "提示词复制失败，请稍后重试。";
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
    actionError.value = exception instanceof Error ? exception.message : "图片保存失败，请稍后重试。";
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
    await router.push({ name: "generate", params: { mode: "image-to-image" } });
  } catch (exception) {
    app.discardReferenceImage();
    actionError.value = exception instanceof Error ? exception.message : "图片读取失败，请稍后重试。";
  }
}

function takeCutoutContextRecord() {
  const record = cutoutContextMenuTarget.value;
  closeTaskMenus();
  return record;
}

async function restoreCutoutWork() {
  const record = takeCutoutContextRecord();
  if (!record) return;
  actionMessage.value = "";
  actionError.value = "";
  try {
    stageCutoutHandoff(await app.restoreCutoutWorkspace(record));
    await router.push({ name: "cutout" });
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "抠图工作恢复失败，请稍后重试。";
  }
}

async function downloadCutoutAssets() {
  const record = takeCutoutContextRecord();
  if (!record) return;
  actionMessage.value = "";
  actionError.value = "";
  try {
    const outcome = await saveImageBlobsToDirectory(await app.loadCutoutAssets([record]));
    if (!outcome.cancelled && outcome.savedCount) actionMessage.value = `已保存 ${outcome.savedCount} 个素材`;
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "素材保存失败，请稍后重试。";
  }
}

async function deleteSelected() {
  if (!selectedCount.value) return;
  const confirmed = window.confirm(`确定从创作历史中删除所选 ${selectedCount.value} 项任务吗？`);
  if (!confirmed) return;
  deleting.value = true;
  actionError.value = "";
  try {
    if (activeTab.value === "cutout") {
      await app.removeCutoutHistory(selectedCutoutRecords.value.map((record) => record.id));
    } else {
      await app.removeHistory(selectedGenerationRecords.value.map((record) => record.generationId));
    }
    clearSelection();
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "删除失败，请稍后重试。";
  } finally {
    deleting.value = false;
  }
}

async function downloadSelected() {
  if (!canDownloadSelection.value) return;
  downloading.value = true;
  actionMessage.value = "";
  actionError.value = "";
  try {
    if (activeTab.value === "cutout") {
      const outcome = await saveImageBlobsToDirectory(
        await app.loadCutoutAssets(selectedCutoutRecords.value)
      );
      if (!outcome.cancelled) actionMessage.value = `已保存 ${outcome.savedCount} 个素材`;
      return;
    }

    const downloads = selectedGenerationRecords.value.flatMap((record) =>
      record.images.map((image, index) => ({
        image,
        suggestedName: `huanhua-${record.generationId}${record.images.length > 1 ? `-${index + 1}` : ""}`
      }))
    );
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
        <p>集中管理生成任务与本地透明素材。</p>
      </div>

      <div
        class="history-mode-switch"
        role="tablist"
        aria-label="历史类型"
        @keydown="handleHistoryTabKeydown"
      >
        <button
          id="history-tab-text-to-image"
          type="button"
          role="tab"
          :class="{ active: activeTab === 'text-to-image' }"
          :aria-selected="activeTab === 'text-to-image'"
          :tabindex="activeTab === 'text-to-image' ? 0 : -1"
          aria-controls="history-tab-panel"
          @click="activeTab = 'text-to-image'"
        >
          <Wand2 :size="15" aria-hidden="true" />文生图
        </button>
        <button
          id="history-tab-image-to-image"
          type="button"
          role="tab"
          :class="{ active: activeTab === 'image-to-image' }"
          :aria-selected="activeTab === 'image-to-image'"
          :tabindex="activeTab === 'image-to-image' ? 0 : -1"
          aria-controls="history-tab-panel"
          @click="activeTab = 'image-to-image'"
        >
          <ImagePlus :size="15" aria-hidden="true" />图生图
        </button>
        <button
          id="history-tab-cutout"
          type="button"
          role="tab"
          :class="{ active: activeTab === 'cutout' }"
          :aria-selected="activeTab === 'cutout'"
          :tabindex="activeTab === 'cutout' ? 0 : -1"
          aria-controls="history-tab-panel"
          @click="activeTab = 'cutout'"
        >
          <Scissors :size="15" aria-hidden="true" />AI 抠图
        </button>
      </div>
    </div>

    <div
      id="history-tab-panel"
      class="history-tab-panel"
      role="tabpanel"
      :aria-labelledby="activeTabId"
    >
      <div class="history-toolbar">
        <span>{{ activeTabLabel }}</span>
        <span>{{ rangeLabel }}</span>
      </div>

      <div v-if="totalItems" class="history-grid">
        <template v-if="activeTab === 'cutout'">
          <CutoutHistoryTaskCard
            v-for="record in paginatedCutoutHistory"
            :key="record.id"
            :record="record"
            :selected="selectedTaskIds.has(record.id)"
            @toggle="toggleSelection"
            @open-menu="openCutoutTaskMenu(record, $event)"
          />
        </template>
        <template v-else>
          <HistoryTaskCard
            v-for="record in paginatedGenerationHistory"
            :key="record.id"
            :record="record"
            :selected="selectedTaskIds.has(record.generationId)"
            @toggle="toggleSelection"
            @copy-prompt="copyPrompt"
            @open-menu="openTaskMenu(record, $event)"
          />
        </template>
      </div>
      <div v-else class="empty-state full">
        <div class="empty-visual"><Clock3 :size="34" /></div>
        <strong>
          暂无{{ activeTab === "cutout" ? "AI 抠图" : activeTab === "text-to-image" ? "文生图" : "图生图" }}记录
        </strong>
        <span v-if="activeTab === 'cutout'">完成 AI 抠图后，工作区与透明素材会自动保存在这里。</span>
        <span v-else>完成对应模式的生成后，任务与作品会自动保存在这里。</span>
      </div>

      <nav v-if="totalItems > pageSize" class="history-pagination" aria-label="历史记录分页">
        <button type="button" aria-label="第一页" title="第一页" :disabled="currentPage === 1" @click="setPage(1)">
          <ChevronsLeft :size="15" />
        </button>
        <button type="button" aria-label="上一页" title="上一页" :disabled="currentPage === 1" @click="setPage(currentPage - 1)">
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
        <button type="button" aria-label="下一页" title="下一页" :disabled="currentPage === totalPages" @click="setPage(currentPage + 1)">
          <ChevronRight :size="15" />
        </button>
        <button type="button" aria-label="最后一页" title="最后一页" :disabled="currentPage === totalPages" @click="setPage(totalPages)">
          <ChevronsRight :size="15" />
        </button>
      </nav>
    </div>

    <p v-if="actionError && !selectedCount" class="history-action-feedback is-error" role="alert">
      <CircleAlert :size="15" aria-hidden="true" /><span>{{ actionError }}</span>
    </p>
    <p v-else-if="actionMessage && !selectedCount" class="history-action-feedback" role="status">
      <CircleCheck :size="15" aria-hidden="true" /><span>{{ actionMessage }}</span>
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
      @close="closeTaskMenus"
      @open-task="openContextTask"
      @copy="copyContextImage"
      @download="downloadContextImage"
      @use-as-reference="useContextImageAsReference"
    />
    <CutoutHistoryTaskContextMenu
      v-if="cutoutContextMenuTarget"
      :x="contextMenuX"
      :y="contextMenuY"
      @close="closeTaskMenus"
      @restore="restoreCutoutWork"
      @download="downloadCutoutAssets"
    />
  </section>
</template>

<style scoped lang="scss">
.history-page-heading {
  align-items: center;
  margin-bottom: 0;
  padding-bottom: 18px;
}

.history-heading-copy,
.history-tab-panel { min-width: 0; }

.history-mode-switch {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-subtle);

  button {
    min-width: 96px;
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

    &:hover,
    &:focus-visible {
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

  > span:first-child { color: var(--soft); }
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 264px);
  grid-auto-rows: 264px;
  align-items: start;
  gap: 12px;
}

.history-view.has-selection { padding-bottom: 108px; }

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

.empty-state.full { min-height: 390px; }

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

@media (max-width: 700px) {
  .history-page-heading {
    display: grid;
    align-items: flex-start;
  }

  .history-mode-switch {
    width: 100%;
    button { min-width: 0; }
  }
}

@media (max-width: 560px) {
  .history-grid { justify-content: center; }
  .history-pagination {
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 4px;
  }
}
</style>
