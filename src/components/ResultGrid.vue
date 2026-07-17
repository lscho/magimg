<script setup lang="ts">
import { computed, shallowRef } from "vue";
import {
  Ban,
  Download,
  FolderOpen,
  Image,
  LoaderCircle,
  Maximize2,
  Pencil,
  RotateCcw
} from "lucide-vue-next";
import { openDirectory, saveRemoteImageAs } from "@/services/desktop";
import type { GeneratedImage, GenerationRecord } from "@/types";

const props = defineProps<{
  record: GenerationRecord | null;
  loading: boolean;
  saveDirectory: string;
  canCancel: boolean;
  recoverableTask: GenerationRecord | null;
}>();

const emit = defineEmits<{
  cancel: [];
  restoreTask: [];
}>();

const resultImages = computed(() => props.record?.images ?? []);
const isSingleResult = computed(() => resultImages.value.length === 1);
const primaryImage = computed(() => resultImages.value[0] ?? null);
const hasSaveDirectory = computed(() => Boolean(props.saveDirectory.trim()));
const recoverableTaskLabel = computed(() => {
  if (!props.recoverableTask) return "";
  const modeLabel = props.recoverableTask.mode === "image-to-image" ? "图生图" : "文生图";
  const statusLabel = props.recoverableTask.status === "queued" ? "排队中" : "生成中";
  return `${modeLabel} · ${statusLabel}`;
});
const saving = shallowRef(false);
const actionError = shallowRef("");

function imageFrameStyle(image: GeneratedImage) {
  return isSingleResult.value ? undefined : { aspectRatio: `${image.width} / ${image.height}` };
}

async function downloadImage() {
  if (!primaryImage.value || !props.record) return;
  saving.value = true;
  actionError.value = "";
  try {
    await saveRemoteImageAs(
      primaryImage.value.remoteUrl,
      `huanhua-${props.record.generationId}`,
      primaryImage.value.mimeType
    );
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "图片保存失败，请稍后重试。";
  } finally {
    saving.value = false;
  }
}

async function openSaveDirectory() {
  actionError.value = "";
  try {
    await openDirectory(props.saveDirectory.trim());
  } catch (exception) {
    actionError.value = exception instanceof Error ? exception.message : "无法打开保存位置。";
  }
}
</script>

<template>
  <section class="result-panel">
    <div class="result-stage">
      <button
        v-if="recoverableTask"
        class="task-recovery-button"
        type="button"
        :aria-label="`恢复${recoverableTaskLabel}任务`"
        title="恢复正在进行的任务"
        @click="emit('restoreTask')"
      >
        <LoaderCircle class="task-recovery-spinner" :size="15" aria-hidden="true" />
        <span>
          <small>正在进行的任务</small>
          <strong>{{ recoverableTaskLabel }}</strong>
        </span>
        <RotateCcw :size="14" aria-hidden="true" />
      </button>
      <div v-if="loading" class="result-loading" role="status" aria-live="polite">
        <div class="image-skeleton" />
        <span>
          <LoaderCircle :size="18" /> 正在创作...
          <button v-if="canCancel" class="cancel-task-button" type="button" @click="emit('cancel')">
            <Ban :size="14" /> 取消任务
          </button>
        </span>
      </div>
      <div v-else-if="resultImages.length" class="image-grid" :class="{ 'single-result': isSingleResult }">
        <figure
          v-for="(image, index) in resultImages"
          :key="image.id"
          class="result-image"
          :style="imageFrameStyle(image)"
        >
          <img :src="image.remoteUrl" :alt="`生成图片 ${index + 1}`" />
        </figure>
      </div>
      <div v-else class="empty-state">
        <div class="empty-visual">
          <Image :size="34" />
        </div>
        <strong>等待你的第一个灵感</strong>
        <span>在右侧完善画面描述与参数，生成的作品会在这里呈现。</span>
      </div>

      <p v-if="actionError" class="result-action-error" role="alert">{{ actionError }}</p>
      <div v-if="resultImages.length && !loading" class="toolbar result-toolbar" role="toolbar" aria-label="图片操作">
        <button class="icon-button result-tool" type="button" title="放大查看" aria-label="放大查看">
          <Maximize2 :size="16" />
        </button>
        <button class="icon-button result-tool" type="button" title="编辑图片" aria-label="编辑图片">
          <Pencil :size="16" />
        </button>
        <button
          class="icon-button result-tool"
          type="button"
          title="下载图片"
          aria-label="下载图片"
          :disabled="saving"
          @click="downloadImage"
        >
          <LoaderCircle v-if="saving" class="saving-spinner" :size="16" />
          <Download v-else :size="16" />
        </button>
        <button
          v-if="hasSaveDirectory"
          class="icon-button result-tool"
          type="button"
          title="打开默认保存位置"
          aria-label="打开默认保存位置"
          @click="openSaveDirectory"
        >
          <FolderOpen :size="16" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.result-panel {
  position: relative;
  min-height: 0;
  display: block;
  overflow: hidden;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: var(--bg);
  box-shadow: none;
}

.result-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  padding: 14px;

  > .empty-state {
    width: 100%;
    height: 100%;
    min-height: 0;
    border: 0;
    background: transparent;
  }
}

.result-tool {
  color: var(--muted);
}

.task-recovery-button {
  position: absolute;
  z-index: 6;
  top: 24px;
  right: 24px;
  min-width: 168px;
  min-height: 42px;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 14px;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  color: var(--soft);
  background: rgba(21, 29, 39, 0.94);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
  text-align: left;
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;

  &:hover,
  &:focus-visible {
    border-color: var(--accent-border);
    color: var(--text);
    background: var(--surface-strong);
  }

  > span {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  small,
  strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--muted);
    font-size: 9px;
    font-weight: 600;
  }

  strong {
    font-size: 11px;
    font-weight: 680;
  }

  > svg:last-child {
    color: var(--accent-strong);
  }
}

.task-recovery-spinner {
  color: var(--accent);
  animation: spin 0.9s linear infinite;
}

.result-toolbar {
  position: absolute;
  z-index: 4;
  top: 24px;
  right: 24px;

  :deep(.icon-button) {
    border-color: rgba(223, 230, 239, 0.16);
    color: var(--text);
    background: rgba(16, 22, 29, 0.84);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
  }
}

.result-action-error {
  position: absolute;
  z-index: 5;
  top: 70px;
  right: 24px;
  max-width: min(380px, calc(100% - 48px));
  margin: 0;
  padding: 8px 10px;
  border: 1px solid rgba(239, 125, 136, 0.42);
  border-radius: 6px;
  color: var(--danger);
  background: rgba(16, 22, 29, 0.94);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.45;
}

.saving-spinner {
  animation: spin 0.9s linear infinite;
}

.image-grid {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-content: start;
  gap: 12px;
  overflow: auto;
  scrollbar-color: var(--line-strong) transparent;

  &.single-result {
    grid-template-columns: minmax(0, 1fr);
    place-items: center;
    overflow: hidden;
  }
}

.result-image {
  position: relative;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--field);
  box-shadow: none;

  img {
    width: 100%;
    height: 100%;
    min-height: 0;
    display: block;
    object-fit: contain;
  }
}

.single-result .result-image {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.image-skeleton {
  min-height: 0;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: linear-gradient(110deg, #111820, #1c2a3e, #111820);
  background-size: 240% 100%;
  animation: shimmer 1.2s ease-in-out infinite;
}

.result-loading {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  place-items: center;

  .image-skeleton {
    width: 100%;
    height: 100%;
  }

  > span {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 11px;
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    color: var(--soft);
    background: rgba(21, 29, 39, 0.94);
    font-size: 11px;

    svg {
      color: var(--accent);
      animation: spin 0.9s linear infinite;
    }
  }
}

.cancel-task-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: 5px;
  padding-left: 10px;
  border-left: 1px solid var(--line-strong);
  color: var(--danger);
  font-size: 11px;
  font-weight: 650;
}

@media (max-width: 900px) {
  .result-panel {
    min-height: 560px;
    border-bottom: 1px solid var(--line);
  }
}

@media (max-width: 600px) {
  .result-stage {
    padding: 14px;
  }

  .image-grid {
    grid-template-columns: 1fr;
    overflow: auto;
  }
}
</style>
