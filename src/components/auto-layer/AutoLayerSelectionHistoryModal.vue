<script setup lang="ts">
import { FolderClock, RotateCcw, Trash2, X } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";
import type { AutoLayerSelectionRecord } from "@/types";

defineProps<{
  records: AutoLayerSelectionRecord[];
}>();

const emit = defineEmits<{
  close: [];
  restore: [record: AutoLayerSelectionRecord];
  remove: [recordId: string];
}>();

const dialog = useTemplateRef<HTMLElement>("dialog");
const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});
let previouslyFocused: HTMLElement | null = null;

onMounted(() => {
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.value?.focus();
});

onBeforeUnmount(() => previouslyFocused?.focus());

function removeRecord(record: AutoLayerSelectionRecord) {
  if (window.confirm(`确定删除“${record.sourceName}”的这条选区记录吗？`)) emit("remove", record.id);
}

function trapFocus(event: KeyboardEvent) {
  const focusable = dialog.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
  );
  if (!focusable?.length) {
    event.preventDefault();
    dialog.value?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
</script>

<template>
  <div class="modal-backdrop selection-history-backdrop" @click.self="emit('close')">
    <Transition name="modal" appear>
      <section
        ref="dialog"
        class="modal selection-history-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="selection-history-title"
        tabindex="-1"
        @keydown.esc.stop="emit('close')"
        @keydown.tab="trapFocus"
      >
        <header class="selection-history-header">
          <div class="selection-history-title">
            <FolderClock :size="19" aria-hidden="true" />
            <div>
              <h2 id="selection-history-title">选区记录</h2>
              <span>{{ records.length }} 条本地记录</span>
            </div>
          </div>
          <button class="icon-button" type="button" aria-label="关闭选区记录" @click="emit('close')">
            <X :size="18" aria-hidden="true" />
          </button>
        </header>

        <div v-if="records.length" class="selection-history-list">
          <article v-for="record in records" :key="record.id" class="selection-history-item">
            <img :src="record.thumbnailUrl" :alt="`${record.sourceName} 预览`" />
            <div class="selection-history-details">
              <strong :title="record.sourceName">{{ record.sourceName }}</strong>
              <span>{{ record.selections.length }} 个选区 · {{ dateFormatter.format(new Date(record.createdAt)) }}</span>
              <span class="selection-history-path" :title="record.sourcePath">{{ record.sourcePath }}</span>
            </div>
            <div class="selection-history-actions">
              <button type="button" class="restore-button" @click="emit('restore', record)">
                <RotateCcw :size="14" aria-hidden="true" /> 恢复
              </button>
              <button
                type="button"
                class="remove-button"
                :aria-label="`删除 ${record.sourceName} 的选区记录`"
                title="删除记录"
                @click="removeRecord(record)"
              >
                <Trash2 :size="14" aria-hidden="true" />
              </button>
            </div>
          </article>
        </div>

        <div v-else class="selection-history-empty">
          <FolderClock :size="28" aria-hidden="true" />
          <strong>暂无选区记录</strong>
          <span>框选后可在底部操作栏保存。</span>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.selection-history-backdrop { z-index: 108; }
.selection-history-modal {
  width: min(680px, 100%);
  max-height: min(680px, calc(100vh - 48px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  padding: 0;
}
.selection-history-modal:focus { outline: none; }
.selection-history-header {
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 12px 10px 16px;
  border-bottom: 1px solid var(--line);
}
.selection-history-title { min-width: 0; display: flex; align-items: center; gap: 10px; color: var(--accent-strong); }
.selection-history-title h2 { margin: 0; color: var(--text); font-size: 16px; letter-spacing: 0; }
.selection-history-title span { display: block; margin-top: 2px; color: var(--muted); font-size: 10px; }
.selection-history-list { min-height: 0; display: grid; gap: 1px; overflow-y: auto; background: var(--line); }
.selection-history-item {
  min-width: 0;
  min-height: 104px;
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--surface-raised);
}
.selection-history-item img { width: 132px; height: 82px; object-fit: contain; border-radius: 5px; background: var(--field); }
.selection-history-details { min-width: 0; display: grid; gap: 5px; }
.selection-history-details strong,
.selection-history-details span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.selection-history-details strong { color: var(--text); font-size: 12px; }
.selection-history-details span { color: var(--muted); font-size: 10px; }
.selection-history-path { color: var(--soft) !important; }
.selection-history-actions { display: flex; align-items: center; gap: 6px; }
.selection-history-actions button {
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--field);
  font-size: 11px;
}
.selection-history-actions button:hover { border-color: var(--line-strong); background: var(--surface-subtle); }
.selection-history-actions button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.restore-button { min-width: 68px; padding: 0 9px; }
.remove-button { width: 32px; padding: 0; color: var(--danger) !important; }
.selection-history-empty { min-height: 260px; display: grid; place-content: center; justify-items: center; gap: 8px; color: var(--muted); }
.selection-history-empty strong { color: var(--text); font-size: 13px; }
.selection-history-empty span { font-size: 11px; }
@media (max-width: 620px) {
  .selection-history-item { grid-template-columns: 92px minmax(0, 1fr); }
  .selection-history-item img { width: 92px; height: 72px; }
  .selection-history-actions { grid-column: 1 / -1; justify-content: flex-end; }
}
</style>
