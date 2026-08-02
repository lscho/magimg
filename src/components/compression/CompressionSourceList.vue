<script setup lang="ts">
import { computed } from "vue";
import {
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  Trash2,
  X
} from "lucide-vue-next";
import CompressionThumbnail from "./CompressionThumbnail.vue";
import type { CompressionWorkspaceItem } from "@/composables/useImageCompression";

const props = withDefaults(defineProps<{
  items: CompressionWorkspaceItem[];
  sessionId?: string;
  preparing?: boolean;
  locked?: boolean;
}>(), {
  sessionId: "",
  preparing: false,
  locked: false
});

const emit = defineEmits<{
  add: [];
  selectFolder: [];
  remove: [itemId: string];
  clear: [];
  retry: [];
}>();

const failedCount = computed(() => props.items.filter((item) => item.status === "failed").length);

const statusLabels: Record<CompressionWorkspaceItem["status"], string> = {
  pending: "待处理",
  processing: "压缩中",
  succeeded: "已完成",
  noBenefit: "无压缩收益",
  skipped: "已跳过",
  failed: "失败",
  cancelled: "已取消"
};

function formatBytes(bytes: number | null) {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatSaved(value: number | null) {
  if (value === null) return "-";
  return value >= 0 ? `${value.toFixed(1)}%` : `增大 ${Math.abs(value).toFixed(1)}%`;
}
</script>

<template>
  <section class="compression-source" aria-labelledby="compression-list-title">
    <header class="source-toolbar">
      <div class="toolbar-title">
        <h1 id="compression-list-title">图片压缩</h1>
        <span v-if="items.length">{{ items.length }} 张</span>
      </div>
      <div class="toolbar-actions">
        <button class="ghost-button" type="button" :disabled="locked || preparing" @click="emit('add')">
          <ImagePlus :size="15" aria-hidden="true" />
          添加图片
        </button>
        <button
          class="ghost-button"
          type="button"
          :disabled="locked || preparing"
          @click="emit('selectFolder')"
        >
          <FolderOpen :size="15" aria-hidden="true" />
          选择文件夹
        </button>
        <button
          v-if="failedCount"
          class="icon-button"
          type="button"
          :disabled="locked"
          aria-label="重试失败项"
          title="重试失败项"
          @click="emit('retry')"
        >
          <RefreshCw :size="15" aria-hidden="true" />
        </button>
        <button
          v-if="items.length"
          class="icon-button"
          type="button"
          :disabled="locked"
          aria-label="清空图片"
          title="清空图片"
          @click="emit('clear')"
        >
          <Trash2 :size="15" aria-hidden="true" />
        </button>
      </div>
    </header>

    <div v-if="!items.length" class="source-empty">
      <LoaderCircle v-if="preparing" class="spin" :size="24" aria-hidden="true" />
      <ImagePlus v-else :size="28" aria-hidden="true" />
      <strong>{{ preparing ? "正在读取图片" : "拖放图片到此处" }}</strong>
      <span v-if="!preparing">支持 PNG、JPEG、WebP</span>
      <div v-if="!preparing" class="empty-actions">
        <button class="primary-small" type="button" @click="emit('add')">
          <ImagePlus :size="15" aria-hidden="true" />
          添加图片
        </button>
        <button class="ghost-button" type="button" @click="emit('selectFolder')">
          <FolderOpen :size="15" aria-hidden="true" />
          选择文件夹
        </button>
      </div>
    </div>

    <div v-else class="source-table-wrap">
      <div class="source-table" role="table" aria-label="待压缩图片">
        <div class="source-row source-head" role="row">
          <span role="columnheader">预览</span>
          <span role="columnheader">格式</span>
          <span role="columnheader">文件</span>
          <span role="columnheader">尺寸</span>
          <span role="columnheader">原始大小</span>
          <span role="columnheader">状态</span>
          <span role="columnheader">输出大小</span>
          <span role="columnheader">节省</span>
          <span aria-hidden="true" />
        </div>
        <div v-for="item in items" :key="item.id" class="source-row" role="row">
          <CompressionThumbnail
            v-if="sessionId"
            :session-id="sessionId"
            :item-id="item.id"
            :alt="item.relativePath"
          />
          <span v-else class="preview-placeholder" role="cell" aria-hidden="true" />
          <span class="format-label" :data-format="item.format" role="cell">{{ item.format }}</span>
          <span class="path-cell" role="cell" :title="item.relativePath">
            <strong>{{ item.relativePath.split('/').pop() }}</strong>
            <small v-if="item.relativePath.includes('/')">{{ item.relativePath }}</small>
          </span>
          <span class="numeric-cell" role="cell">{{ item.width }} × {{ item.height }}</span>
          <span class="numeric-cell" role="cell">{{ formatBytes(item.size) }}</span>
          <span class="status-cell" :data-status="item.status" role="cell" :title="item.message">
            <LoaderCircle v-if="item.status === 'processing'" class="spin" :size="13" aria-hidden="true" />
            {{ statusLabels[item.status] }}
          </span>
          <span class="numeric-cell" role="cell">{{ formatBytes(item.outputSize) }}</span>
          <span class="numeric-cell" role="cell">{{ formatSaved(item.savedPercent) }}</span>
          <button
            class="remove-button"
            type="button"
            :disabled="locked"
            :aria-label="`移除 ${item.relativePath}`"
            title="移除"
            @click="emit('remove', item.id)"
          >
            <X :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.compression-source {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 62px minmax(0, 1fr);
  background: var(--bg);
}

.source-toolbar {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.toolbar-title {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 9px;

  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 680;
  }

  span {
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
}

.toolbar-actions,
.empty-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.source-empty {
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 24px;
  border: 1px dashed var(--line-strong);
  border-radius: 8px;
  color: var(--muted);
  background: rgba(16, 22, 29, 0.56);

  strong {
    color: var(--soft);
    font-size: 14px;
  }

  span {
    font-size: 11px;
  }

  .empty-actions {
    margin-top: 8px;
  }
}

.source-table-wrap {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}

.source-table {
  min-width: 958px;
}

.source-row {
  min-height: 58px;
  display: grid;
  grid-template-columns: 48px 60px minmax(190px, 1fr) 112px 92px 116px 92px 82px 34px;
  align-items: center;
  gap: 10px;
  padding: 7px 16px;
  border-bottom: 1px solid var(--line);
  color: var(--soft);
  font-size: 11px;

  &:not(.source-head):hover {
    background: var(--surface);
  }
}

.preview-placeholder {
  width: 42px;
  height: 42px;
}

.source-head {
  position: sticky;
  z-index: 2;
  top: 0;
  min-height: 34px;
  color: var(--muted);
  background: #0b1016;
  font-size: 10px;
  font-weight: 650;
}

.format-label {
  width: 44px;
  padding: 3px 0;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  color: var(--soft);
  text-align: center;
  text-transform: uppercase;

  &[data-format="png"] { color: var(--tech-cyan); }
  &[data-format="jpeg"] { color: var(--warm); }
  &[data-format="webp"] { color: var(--accent-strong); }
}

.path-cell {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;

  strong,
  small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong { color: var(--text); font-size: 12px; }
  small { color: var(--muted); font-size: 10px; }
}

.numeric-cell {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.status-cell {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-status="succeeded"] { color: var(--success); }
  &[data-status="failed"] { color: var(--danger); }
  &[data-status="processing"] { color: var(--accent-strong); }
  &[data-status="noBenefit"],
  &[data-status="skipped"],
  &[data-status="cancelled"] { color: var(--muted); }
}

.remove-button {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  color: var(--muted);
  background: transparent;

  &:hover:not(:disabled) {
    color: var(--danger);
    background: rgba(239, 125, 136, 0.1);
  }
}

.spin { animation: spin 0.9s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 720px) {
  .source-toolbar {
    min-height: 104px;
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
    padding: 12px 14px;
  }

  .toolbar-actions {
    width: 100%;
    overflow-x: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .spin { animation-duration: 1.8s; }
}
</style>
