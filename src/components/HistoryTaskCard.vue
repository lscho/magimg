<script setup lang="ts">
import { computed } from "vue";
import { CalendarDays, Check, Coins, Copy, ImageOff } from "lucide-vue-next";
import type { GenerationRecord, GenerationStatus } from "@/types";

const props = defineProps<{
  record: GenerationRecord;
  selected: boolean;
}>();

const emit = defineEmits<{
  toggle: [generationId: string];
  openMenu: [position: { x: number; y: number }];
  copyPrompt: [prompt: string];
}>();

const statusDetails: Record<GenerationStatus, { label: string; className: string }> = {
  queued: { label: "排队中", className: "status-queued" },
  processing: { label: "生成中", className: "status-processing" },
  succeeded: { label: "已完成", className: "status-succeeded" },
  failed: { label: "失败", className: "status-failed" },
  cancelled: { label: "已取消", className: "status-cancelled" }
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const previewImage = computed(() => props.record.images[0]);
const statusDetail = computed(() => statusDetails[props.record.status]);
const creditsLabel = computed(() => {
  if (props.record.status === "failed" || props.record.status === "cancelled") return "0 积分";
  return `${props.record.costCredits} 积分`;
});
const creditsTitle = computed(() => {
  if (props.record.status === "failed" || props.record.status === "cancelled") return "积分已退回";
  if (props.record.status === "queued" || props.record.status === "processing") return "预扣积分";
  return "消耗积分";
});

function openContextMenu(event: MouseEvent) {
  emit("openMenu", { x: event.clientX, y: event.clientY });
}

function openContextMenuFromKeyboard(event: KeyboardEvent) {
  const isMenuShortcut = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
  if (!isMenuShortcut) return;

  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  emit("openMenu", {
    x: rect.left + Math.min(28, rect.width / 2),
    y: rect.top + Math.min(28, rect.height / 2)
  });
}

</script>

<template>
  <article
    class="history-task-card"
    :class="{ selected }"
    @contextmenu.prevent.stop="openContextMenu"
  >
    <div class="history-task-media">
      <button
        class="history-task-select"
        type="button"
        :aria-label="selected ? '取消选择此历史任务' : '选择此历史任务'"
        :aria-pressed="selected"
        @click="emit('toggle', record.generationId)"
        @keydown="openContextMenuFromKeyboard"
      >
        <img
          v-if="previewImage"
          :src="previewImage.remoteUrl"
          :alt="`${record.mode === 'text-to-image' ? '文生图' : '图生图'}历史作品`"
          loading="lazy"
          decoding="async"
        />
        <span v-else class="history-task-placeholder">
          <ImageOff :size="24" aria-hidden="true" />
        </span>
      </button>

      <span v-if="selected" class="history-selected-mark" aria-hidden="true">
        <Check :size="15" :stroke-width="2.5" />
      </span>
      <span class="history-status history-status-overlay" :class="statusDetail.className">
        <i aria-hidden="true"></i>{{ statusDetail.label }}
      </span>

      <div class="history-task-overlay">
        <h2 :title="record.params.prompt">{{ record.params.prompt }}</h2>
        <p v-if="record.errorMessage" class="history-task-error" :title="record.errorMessage">
          {{ record.errorMessage }}
        </p>

        <div class="history-task-meta">
          <span class="history-meta credits-value" :title="creditsTitle">
            <Coins :size="13" aria-hidden="true" />{{ creditsLabel }}
          </span>
          <span class="history-size-tag">{{ record.params.size }}</span>
        </div>
        <div class="history-task-actions">
          <time
            class="history-created-at"
            :datetime="record.createdAt"
            :title="new Date(record.createdAt).toLocaleString('zh-CN')"
          >
            <CalendarDays :size="13" aria-hidden="true" />
            {{ dateFormatter.format(new Date(record.createdAt)) }}
          </time>
          <button
            type="button"
            class="history-copy-prompt"
            title="复制提示词"
            aria-label="复制提示词"
            @click.stop="emit('copyPrompt', record.params.prompt)"
          >
            <Copy :size="14" aria-hidden="true" />
            <span>复制提示词</span>
          </button>
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
.history-task-card {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  &:hover,
  &:focus-within {
    border-color: var(--line-strong);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);

    .history-task-overlay { opacity: 1; }
  }

  &.selected {
    border-color: var(--accent);
    box-shadow:
      0 0 0 2px var(--accent-soft),
      0 10px 24px rgba(0, 0, 0, 0.2);
  }
}

.history-task-media {
  position: relative;
  width: 100%;
  height: 100%;
  display: block;
  overflow: hidden;
  background: var(--field);
}

.history-task-select {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  padding: 0;
  border-radius: 0;
  background: transparent;
  text-align: initial;

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: cover;
  }

  &:focus-visible {
    outline-offset: -3px;
  }
}

.history-task-placeholder {
  width: 100%;
  height: 100%;
  display: grid;
  place-content: center;
  place-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 10px;
}

.history-size-tag {
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.08);
  font-size: 8px;
  font-weight: 700;
  white-space: nowrap;
}

.history-selected-mark {
  position: absolute;
  top: 8px;
  left: 8px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: 1px solid var(--accent-strong);
  border-radius: 6px;
  color: var(--on-accent);
  background: var(--accent);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
}

.history-status-overlay {
  position: absolute;
  top: 8px;
  right: 8px;
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px;
  background: rgba(8, 11, 16, 0.84);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  font-size: 10px;
  font-weight: 700;
}

.history-task-overlay {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  align-content: end;
  gap: 9px;
  padding: 46px 12px 12px;
  opacity: 0;
  color: #fff;
  background: linear-gradient(to top, rgba(4, 7, 11, 0.94) 0%, rgba(4, 7, 11, 0.52) 48%, transparent 78%);
  transition: opacity 0.2s ease;
}

.history-task-overlay h2 {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: #fff;
  font-size: 13px;
  font-weight: 620;
  line-height: 1.55;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.history-task-meta {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.history-task-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;

  i {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: currentColor;
  }

  &.status-queued {
    color: var(--accent-strong);
  }

  &.status-processing {
    color: var(--tech-cyan);
  }

  &.status-succeeded {
    color: var(--success);
  }

  &.status-failed {
    color: var(--danger);
  }

  &.status-cancelled {
    color: var(--muted);
  }
}

.history-meta {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  padding: 4px 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.82);
  background: rgba(255, 255, 255, 0.08);
  font-size: 9px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;

}

.credits-value {
  color: #f5d783;
  background: rgba(245, 215, 131, 0.12);
}

.history-created-at {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  color: rgba(255, 255, 255, 0.82);
  font-size: 9px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-copy-prompt {
  pointer-events: auto;
  min-height: 27px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 5px;
  color: #fff;
  background: rgba(8, 11, 16, 0.72);
  font-size: 9px;
  font-weight: 650;

  &:hover,
  &:focus-visible {
    border-color: rgba(255, 255, 255, 0.42);
    background: rgba(25, 31, 40, 0.94);
  }
}

.history-task-error {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--danger);
  font-size: 10px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

@media (hover: none) {
  .history-task-overlay { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .history-task-card,
  .history-task-overlay { transition: none; }
}

</style>
