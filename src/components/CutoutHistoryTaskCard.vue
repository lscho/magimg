<script setup lang="ts">
import { computed } from "vue";
import { CalendarDays, Check, Coins } from "lucide-vue-next";
import type { CutoutHistoryRecord } from "@/types";

const props = defineProps<{
  record: CutoutHistoryRecord;
  selected: boolean;
}>();

const emit = defineEmits<{
  toggle: [taskId: string];
  openMenu: [position: { x: number; y: number }];
}>();

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const previewAssets = computed(() => props.record.assets.slice(0, 4));
const remainingCount = computed(() => Math.max(0, props.record.assets.length - 4));
const backgroundCount = computed(() =>
  props.record.assets.filter((asset) => asset.kind === "background").length
);
const previewCountClass = computed(() => `count-${Math.min(4, previewAssets.value.length)}`);

function openContextMenu(event: MouseEvent) {
  emit("openMenu", { x: event.clientX, y: event.clientY });
}

function openContextMenuFromKeyboard(event: KeyboardEvent) {
  const isMenuShortcut = event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
  if (!isMenuShortcut) return;
  event.preventDefault();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  emit("openMenu", {
    x: rect.left + Math.min(28, rect.width / 2),
    y: rect.top + Math.min(28, rect.height / 2)
  });
}
</script>

<template>
  <article
    class="cutout-history-card"
    :class="{ selected }"
    @contextmenu.prevent.stop="openContextMenu"
  >
    <button
      class="cutout-history-media"
      type="button"
      :aria-label="selected ? '取消选择此抠图任务' : '选择此抠图任务'"
      :aria-pressed="selected"
      @click="emit('toggle', record.id)"
      @keydown="openContextMenuFromKeyboard"
    >
      <span class="cutout-history-preview-grid" :class="previewCountClass">
        <span
          v-for="asset in previewAssets"
          :key="asset.id"
          class="cutout-history-preview-cell"
        >
          <img
            :src="asset.thumbnailUrl"
            :alt="`${asset.kind === 'background' ? '背景' : '透明素材'} ${asset.width}×${asset.height}`"
            loading="lazy"
            decoding="async"
          />
        </span>
      </span>
      <span v-if="selected" class="cutout-history-selected-mark" aria-hidden="true">
        <Check :size="15" :stroke-width="2.5" />
      </span>
      <span class="cutout-history-status"><i aria-hidden="true" />已完成</span>
      <span class="cutout-history-count">
        {{ record.assets.length }} 个结果<span v-if="backgroundCount"> · {{ backgroundCount }} 背景</span><span v-if="remainingCount"> · +{{ remainingCount }}</span>
      </span>
    </button>

    <div class="cutout-history-content">
      <h2 :title="record.source.originalName">{{ record.source.originalName }}</h2>
      <div class="cutout-history-meta-row">
        <span class="cutout-history-meta credits" title="消耗积分">
          <Coins :size="14" aria-hidden="true" />-{{ record.costCredits }}
        </span>
        <time
          class="cutout-history-meta"
          :datetime="record.createdAt"
          :title="new Date(record.createdAt).toLocaleString('zh-CN')"
        >
          <CalendarDays :size="14" aria-hidden="true" />
          {{ dateFormatter.format(new Date(record.createdAt)) }}
        </time>
      </div>
    </div>
  </article>
</template>

<style scoped lang="scss">
.cutout-history-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-raised);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;

  &:hover {
    border-color: var(--line-strong);
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
  }

  &.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft), 0 10px 24px rgba(0, 0, 0, 0.2);
  }
}

.cutout-history-media {
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

  &:focus-visible { outline-offset: -3px; }
}

.cutout-history-preview-grid {
  width: 100%;
  height: 100%;
  display: grid;
  gap: 1px;
  background: var(--line);

  &.count-1 { grid-template-columns: 1fr; }
  &.count-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  &.count-3,
  &.count-4 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
  }
}

.cutout-history-preview-cell {
  min-width: 0;
  min-height: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  background-color: #17202a;
  background-image:
    linear-gradient(45deg, rgba(241, 244, 248, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(241, 244, 248, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(241, 244, 248, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(241, 244, 248, 0.08) 75%);
  background-position: 0 0, 0 7px, 7px -7px, -7px 0;
  background-size: 14px 14px;

  img {
    max-width: 100%;
    max-height: 100%;
    display: block;
    object-fit: contain;
  }
}

.cutout-history-selected-mark,
.cutout-history-status,
.cutout-history-count {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 5px;
  color: #fff;
  background: rgba(8, 11, 16, 0.84);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.cutout-history-selected-mark {
  top: 8px;
  left: 8px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-color: var(--accent-strong);
  color: var(--on-accent);
  background: var(--accent);
}

.cutout-history-status {
  top: 8px;
  right: 8px;
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  color: var(--success);
  font-size: 10px;
  font-weight: 700;

  i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }
}

.cutout-history-count {
  right: 8px;
  bottom: 8px;
  padding: 4px 6px;
  font-size: 8px;
  font-weight: 700;
}

.cutout-history-content {
  display: grid;
  gap: 10px;
  padding: 12px;

  h2 {
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
    overflow-wrap: anywhere;
  }
}

.cutout-history-meta-row {
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--line);
}

.cutout-history-meta {
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

  &:last-child { justify-self: end; }
  &.credits { color: var(--warm); }
}

@media (prefers-reduced-motion: reduce) {
  .cutout-history-card { transition: none; }
}
</style>
