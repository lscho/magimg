<script setup lang="ts">
import { computed } from "vue";
import { ImageOff } from "lucide-vue-next";
import type { GenerationRecord, GenerationStatus } from "@/types";

const props = defineProps<{ record: GenerationRecord }>();

const statusDetails: Record<GenerationStatus, { label: string; className: string }> = {
  queued: { label: "排队中", className: "status-queued" },
  processing: { label: "生成中", className: "status-processing" },
  succeeded: { label: "已完成", className: "status-succeeded" },
  failed: { label: "失败", className: "status-failed" },
  cancelled: { label: "已取消", className: "status-cancelled" }
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const previewImage = computed(() => props.record.images[0]);
const statusDetail = computed(() => statusDetails[props.record.status]);
const durationLabel = computed(() => formatDuration(props.record));
const creditsLabel = computed(() => {
  if (props.record.status === "failed" || props.record.status === "cancelled") return "0（已退回）";
  if (props.record.status === "queued" || props.record.status === "processing") {
    return `-${props.record.costCredits}（预扣）`;
  }
  return `-${props.record.costCredits}`;
});

function formatDuration(record: GenerationRecord) {
  if (record.status === "queued") return "等待中";
  if (record.status === "processing") return "进行中";
  if (!record.startedAt || !record.finishedAt) return "未记录";

  const milliseconds = Date.parse(record.finishedAt) - Date.parse(record.startedAt);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "未记录";

  const totalSeconds = Math.floor(milliseconds / 1000);
  if (totalSeconds < 1) return "< 1 秒";
  if (totalSeconds < 60) return `${totalSeconds} 秒`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}
</script>

<template>
  <article class="history-task-card">
    <div class="history-task-media">
      <img
        v-if="previewImage"
        :src="previewImage.remoteUrl"
        :alt="`${record.mode === 'text-to-image' ? '文生图' : '图生图'}历史作品`"
        loading="lazy"
        decoding="async"
      />
      <div v-else class="history-task-placeholder">
        <ImageOff :size="24" aria-hidden="true" />
        <span>{{ statusDetail.label }}</span>
      </div>
      <span class="history-size-tag">{{ record.params.size }}</span>
    </div>

    <div class="history-task-content">
      <div class="history-task-heading">
        <span>{{ record.mode === "text-to-image" ? "文生图" : "图生图" }}</span>
        <span>{{ record.params.quality === "auto" ? "自动质量" : record.params.quality }}</span>
      </div>

      <h2 :title="record.params.prompt">{{ record.params.prompt }}</h2>

      <dl class="history-task-facts">
        <div>
          <dt>任务状态</dt>
          <dd class="history-status" :class="statusDetail.className">
            <i aria-hidden="true"></i>{{ statusDetail.label }}
          </dd>
        </div>
        <div>
          <dt>任务耗时</dt>
          <dd>{{ durationLabel }}</dd>
        </div>
        <div>
          <dt>积分消耗</dt>
          <dd class="credits-value">{{ creditsLabel }}</dd>
        </div>
        <div>
          <dt>创建时间</dt>
          <dd :title="dateFormatter.format(new Date(record.createdAt))">
            {{ dateFormatter.format(new Date(record.createdAt)) }}
          </dd>
        </div>
      </dl>

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
}

.history-task-media {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-bottom: 1px solid var(--line);
  background: var(--field);

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
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

.history-task-content {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.history-task-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--muted);
  font-size: 9px;
  font-weight: 700;

  > span:first-child {
    color: var(--accent-strong);
  }
}

.history-task-content h2 {
  min-height: calc(3em * 1.55);
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 12px;
  font-weight: 620;
  line-height: 1.55;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.history-task-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0;
  border-top: 1px solid var(--line);
  border-left: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;

  > div {
    min-width: 0;
    display: grid;
    gap: 5px;
    padding: 9px;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    background: var(--field);
  }

  dt,
  dd {
    margin: 0;
  }

  dt {
    color: var(--muted);
    font-size: 8px;
    font-weight: 650;
  }

  dd {
    overflow: hidden;
    color: var(--soft);
    font-size: 10px;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
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

.credits-value {
  color: var(--warm) !important;
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

@media (max-width: 420px) {
  .history-task-facts {
    grid-template-columns: 1fr;
  }
}
</style>
