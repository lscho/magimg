<script setup lang="ts">
import { Download, LoaderCircle, Trash2, X } from "lucide-vue-next";

defineProps<{
  selectedCount: number;
  downloading: boolean;
  deleting: boolean;
  message: string;
  error: string;
}>();

const emit = defineEmits<{
  clear: [];
  delete: [];
  download: [];
}>();
</script>

<template>
  <div class="history-selection-bar" role="toolbar" aria-label="已选历史作品操作">
    <div class="history-selection-summary">
      <strong>已选 {{ selectedCount }} 项</strong>
      <span v-if="error" class="history-selection-feedback error" role="alert">{{ error }}</span>
      <span v-else-if="message" class="history-selection-feedback" role="status">{{ message }}</span>
    </div>

    <div class="history-selection-actions">
      <button
        class="selection-action danger"
        type="button"
        title="从历史中删除"
        aria-label="从历史中删除所选任务"
        :disabled="downloading || deleting"
        @click="emit('delete')"
      >
        <LoaderCircle v-if="deleting" class="selection-spinner" :size="17" />
        <Trash2 v-else :size="17" />
      </button>
      <button
        class="selection-action primary"
        type="button"
        title="批量下载"
        aria-label="批量下载所选作品"
        :disabled="downloading || deleting"
        @click="emit('download')"
      >
        <LoaderCircle v-if="downloading" class="selection-spinner" :size="17" />
        <Download v-else :size="17" />
      </button>
      <button
        class="selection-action"
        type="button"
        title="取消选择"
        aria-label="取消全部选择"
        :disabled="downloading || deleting"
        @click="emit('clear')"
      >
        <X :size="17" />
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.history-selection-bar {
  position: fixed;
  z-index: 14;
  left: calc(50% + 30px);
  bottom: 20px;
  width: min(520px, calc(100vw - 100px));
  min-height: 58px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 24px auto 0;
  padding: 9px 10px 9px 16px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  color: var(--text);
  background: rgba(16, 22, 29, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.34);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  transform: translateX(-50%);
}

.history-selection-summary {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;

  strong {
    flex: 0 0 auto;
    color: var(--accent-strong);
    font-size: 12px;
    font-weight: 700;
  }
}

.history-selection-feedback {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 10px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.error {
    color: var(--danger);
  }
}

.history-selection-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.selection-action {
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--muted);
  background: var(--surface-subtle);
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;

  &:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--line-strong);
    background: var(--surface-strong);
  }

  &.danger {
    color: var(--danger);
  }

  &.primary {
    color: var(--on-accent);
    border-color: var(--accent);
    background: var(--accent);

    &:hover:not(:disabled) {
      color: var(--on-accent);
      border-color: var(--accent-strong);
      background: var(--accent-strong);
    }
  }
}

.selection-spinner {
  animation: spin 0.9s linear infinite;
}

@media (max-width: 560px) {
  .history-selection-bar {
    padding-left: 12px;
  }

  .history-selection-summary {
    display: grid;
    gap: 2px;
  }

  .history-selection-feedback {
    max-width: 150px;
  }
}

@media (max-width: 900px) {
  .history-selection-bar {
    left: 50%;
    bottom: 16px;
    width: calc(100vw - 32px);
  }
}
</style>
