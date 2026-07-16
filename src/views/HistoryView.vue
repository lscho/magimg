<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  ImagePlus,
  Trash2,
  Wand2
} from "lucide-vue-next";
import HistoryTaskCard from "@/components/HistoryTaskCard.vue";
import { useAppStore } from "@/stores/app";
import type { GenerationMode } from "@/types";

const app = useAppStore();
const pageSize = 12;
const activeMode = shallowRef<GenerationMode>("text-to-image");
const currentPage = shallowRef(1);

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

watch(activeMode, () => {
  currentPage.value = 1;
});

watch(totalPages, (pageCount) => {
  currentPage.value = Math.min(currentPage.value, pageCount);
});

function setPage(page: number) {
  currentPage.value = Math.min(totalPages.value, Math.max(1, page));
}
</script>

<template>
  <section class="page-view history-view">
    <div class="page-heading history-page-heading">
      <div class="history-heading-copy">
        <span class="section-kicker">CREATION LOG</span>
        <h1>创作历史</h1>
        <p>回看每一次生成的状态、耗时与积分记录。</p>
      </div>

      <div class="history-heading-actions">
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
        <button
          class="icon-button danger history-clear"
          type="button"
          :disabled="!app.history.length"
          aria-label="清空本地历史"
          title="清空本地历史"
          @click="app.clearHistory"
        >
          <Trash2 :size="16" />
        </button>
      </div>
    </div>

    <div class="history-toolbar">
      <span>{{ activeMode === "text-to-image" ? "文生图任务" : "图生图任务" }}</span>
      <span>{{ rangeLabel }}</span>
    </div>

    <div v-if="paginatedHistory.length" class="history-grid">
      <HistoryTaskCard v-for="record in paginatedHistory" :key="record.id" :record="record" />
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

.history-heading-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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

.history-clear {
  flex: 0 0 auto;
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

  .history-heading-actions {
    width: 100%;
  }

  .history-mode-switch {
    flex: 1;

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
