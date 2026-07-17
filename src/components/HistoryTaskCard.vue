<script setup lang="ts">
import { computed } from "vue";
import { CalendarDays, Check, Coins, ImageOff } from "lucide-vue-next";
import type { GenerationRecord, GenerationStatus } from "@/types";

const props = defineProps<{
  record: GenerationRecord;
  selected: boolean;
}>();

const emit = defineEmits<{
  toggle: [generationId: string];
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
  if (props.record.status === "failed" || props.record.status === "cancelled") return "0";
  if (props.record.status === "queued" || props.record.status === "processing") {
    return `-${props.record.costCredits}`;
  }
  return `-${props.record.costCredits}`;
});
const creditsTitle = computed(() => {
  if (props.record.status === "failed" || props.record.status === "cancelled") return "积分已退回";
  if (props.record.status === "queued" || props.record.status === "processing") return "预扣积分";
  return "消耗积分";
});
</script>

<template>
  <article class="history-task-card" :class="{ selected }">
    <button
      v-if="previewImage"
      class="history-task-media"
      type="button"
      :aria-label="selected ? '取消选择此历史作品' : '选择此历史作品'"
      :aria-pressed="selected"
      @click="emit('toggle', record.generationId)"
    >
      <img
        :src="previewImage.remoteUrl"
        :alt="`${record.mode === 'text-to-image' ? '文生图' : '图生图'}历史作品`"
        loading="lazy"
        decoding="async"
      />
      <span v-if="selected" class="history-selected-mark" aria-hidden="true">
        <Check :size="15" :stroke-width="2.5" />
      </span>
      <span class="history-status history-status-overlay" :class="statusDetail.className">
        <i aria-hidden="true"></i>{{ statusDetail.label }}
      </span>
      <span class="history-size-tag">{{ record.params.size }}</span>
    </button>
    <div v-else class="history-task-media">
      <div class="history-task-placeholder">
        <ImageOff :size="24" aria-hidden="true" />
      </div>
      <span class="history-status history-status-overlay" :class="statusDetail.className">
        <i aria-hidden="true"></i>{{ statusDetail.label }}
      </span>
      <span class="history-size-tag">{{ record.params.size }}</span>
    </div>

    <div class="history-task-content">
      <h2 :title="record.params.prompt">{{ record.params.prompt }}</h2>

      <div class="history-task-meta">
        <span class="history-meta credits-value" :title="creditsTitle">
          <Coins :size="14" aria-hidden="true" />{{ creditsLabel }}
        </span>
        <time
          class="history-meta"
          :datetime="record.createdAt"
          :title="new Date(record.createdAt).toLocaleString('zh-CN')"
        >
          <CalendarDays :size="14" aria-hidden="true" />
          {{ dateFormatter.format(new Date(record.createdAt)) }}
        </time>
      </div>

      <p v-if="record.errorMessage" class="history-task-error" :title="record.errorMessage">
        {{ record.errorMessage }}
      </p>
    </div>
  </article>
</template>

<style scoped lang="scss">
.history-task-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  box-shadow: none;
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  &:hover {
    border-color: var(--line-strong);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
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
  aspect-ratio: 4 / 3;
  display: block;
  overflow: hidden;
  padding: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: var(--field);
  text-align: initial;

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
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
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 4px 6px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  color: #fff;
  background: rgba(8, 11, 16, 0.82);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  font-size: 8px;
  font-weight: 700;
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

.history-task-content {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.history-task-content h2 {
  min-height: calc(2em * 1.55);
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  font-weight: 620;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.history-task-meta {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
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
  color: var(--muted);
  font-size: 11px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:last-child {
    justify-self: end;
  }
}

.credits-value {
  color: var(--warm);
}

.history-task-error {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--danger);
  font-size: 10px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

</style>
