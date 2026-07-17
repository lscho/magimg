<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, useTemplateRef } from "vue";
import { Download, RefreshCw, RotateCw, ShieldAlert, X } from "lucide-vue-next";
import type { AppUpdateStatus } from "@/composables/useAppUpdater";
import type { DesktopUpdateInfo } from "@/services/updater";

const props = defineProps<{
  info: DesktopUpdateInfo;
  status: AppUpdateStatus;
  canDismiss: boolean;
  downloadedBytes: number;
  totalBytes: number | null;
  progressPercent: number | null;
  errorMessage: string;
  installed: boolean;
}>();

const emit = defineEmits<{
  dismiss: [];
  install: [];
  restart: [];
}>();

const dialog = useTemplateRef<HTMLElement>("dialog");
let previouslyFocused: HTMLElement | null = null;

const isBusy = computed(() => ["downloading", "installing", "restarting"].includes(props.status));
const showProgress = computed(() => ["downloading", "installing", "restarting"].includes(props.status));
const primaryLabel = computed(() => {
  if (props.status === "downloading") return "正在下载";
  if (props.status === "installing") return "正在安装";
  if (props.status === "restarting") return "正在重启";
  if (props.status === "error") return props.installed ? "重新启动" : "重试更新";
  return "更新并重启";
});
const statusMessage = computed(() => {
  if (props.status === "downloading") {
    return props.progressPercent === null ? "正在下载更新包" : `正在下载更新包 ${props.progressPercent}%`;
  }
  if (props.status === "installing") return "下载完成，正在校验并安装更新";
  if (props.status === "restarting") return "更新已安装，正在重新启动客户端";
  if (props.status === "error") {
    if (props.installed) return "更新已安装，需要重新启动客户端";
    return props.info.isForceUpdate ? "更新未完成，请重试后继续使用" : "更新未完成，当前版本未发生变化";
  }
  return props.info.isForceUpdate ? "此版本需要更新后才能继续使用" : "新版本已发布，可立即更新";
});
const progressStyle = computed(() => ({ width: `${props.progressPercent ?? 0}%` }));
const progressLabel = computed(() => {
  if (props.status !== "downloading") return statusMessage.value;
  if (!props.totalBytes) return statusMessage.value;
  return `${formatBytes(props.downloadedBytes)} / ${formatBytes(props.totalBytes)}`;
});

onMounted(() => {
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.value?.focus();
});

onBeforeUnmount(() => {
  previouslyFocused?.focus();
});

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function requestDismiss() {
  if (props.canDismiss) emit("dismiss");
}

function runPrimaryAction() {
  if (props.installed) emit("restart");
  else emit("install");
}

function trapFocus(event: KeyboardEvent) {
  const focusable = dialog.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
  <div class="modal-backdrop update-backdrop" @click.self="requestDismiss">
    <Transition name="modal" appear>
      <section
        ref="dialog"
        class="modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        aria-describedby="update-modal-status"
        tabindex="-1"
        @keydown.esc="requestDismiss"
        @keydown.tab="trapFocus"
      >
        <button
          v-if="canDismiss"
          class="icon-button update-close"
          type="button"
          aria-label="稍后更新"
          @click="emit('dismiss')"
        >
          <X :size="18" aria-hidden="true" />
        </button>

        <header class="update-header">
          <div class="update-icon" :class="{ force: info.isForceUpdate }" aria-hidden="true">
            <ShieldAlert v-if="info.isForceUpdate" :size="22" />
            <Download v-else :size="22" />
          </div>
          <div class="update-heading">
            <span class="section-kicker">{{ info.isForceUpdate ? "REQUIRED UPDATE" : "SOFTWARE UPDATE" }}</span>
            <h2 id="update-modal-title">{{ info.isForceUpdate ? "需要更新客户端" : "发现新版本" }}</h2>
            <p class="update-version">当前 {{ info.currentVersion }} · 最新 {{ info.version }}</p>
          </div>
        </header>

        <p id="update-modal-status" class="update-status" aria-live="polite">{{ statusMessage }}</p>

        <div v-if="info.notes" class="update-notes">
          <span>更新内容</span>
          <p>{{ info.notes }}</p>
        </div>

        <div v-if="showProgress" class="update-progress" aria-live="polite">
          <div
            class="update-progress-track"
            :class="{ indeterminate: progressPercent === null && status === 'downloading' }"
            role="progressbar"
            :aria-label="progressLabel"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="progressPercent ?? undefined"
          >
            <span v-if="progressPercent !== null" :style="progressStyle" />
          </div>
          <span class="update-progress-label">{{ progressLabel }}</span>
        </div>

        <div v-if="status === 'error'" class="update-error" role="alert">
          <ShieldAlert :size="16" aria-hidden="true" />
          <span>{{ errorMessage }}</span>
        </div>

        <footer class="update-actions">
          <button v-if="canDismiss" class="ghost-button" type="button" @click="emit('dismiss')">稍后</button>
          <button class="primary-small update-primary" type="button" :disabled="isBusy" @click="runPrimaryAction">
            <RotateCw v-if="installed || status === 'restarting'" :size="16" aria-hidden="true" />
            <RefreshCw v-else-if="status === 'error'" :size="16" aria-hidden="true" />
            <Download v-else :size="16" aria-hidden="true" />
            {{ primaryLabel }}
          </button>
        </footer>
      </section>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.update-backdrop {
  z-index: 100;
}

.update-modal {
  width: min(500px, 100%);
  max-height: min(680px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow: auto;
  padding: 24px;
}

.update-close {
  position: absolute;
  top: 16px;
  right: 16px;
}

.update-header {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: start;
  gap: 14px;
  padding-right: 42px;
}

.update-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  color: var(--accent-strong);
  background: var(--accent-soft);

  &.force {
    border-color: rgba(239, 125, 136, 0.48);
    color: var(--danger);
    background: rgba(239, 125, 136, 0.12);
  }
}

.update-heading {
  min-width: 0;

  h2 {
    margin-top: 3px;
  }
}

.update-version {
  margin: 6px 0 0 !important;
  color: var(--soft) !important;
  font-variant-numeric: tabular-nums;
}

.update-status {
  margin: -4px 0 0 !important;
  color: var(--soft) !important;
  font-size: 13px !important;
}

.update-notes {
  min-height: 0;
  padding: 14px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);

  > span {
    display: block;
    margin-bottom: 8px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 700;
  }

  p {
    max-height: 190px;
    margin: 0;
    overflow: auto;
    color: var(--soft);
    font-size: 12px;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}

.update-progress {
  display: grid;
  gap: 8px;
}

.update-progress-track {
  position: relative;
  width: 100%;
  height: 7px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--surface-strong);

  > span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
    transition: width 0.16s ease;
  }

  &.indeterminate::after {
    position: absolute;
    inset: 0 auto 0 -35%;
    width: 35%;
    border-radius: inherit;
    background: var(--accent);
    animation: update-progress 1.1s ease-in-out infinite;
    content: "";
  }
}

.update-progress-label {
  color: var(--muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.update-error {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  padding: 10px 12px;
  border-left: 2px solid var(--danger);
  color: var(--soft);
  background: rgba(239, 125, 136, 0.09);
  font-size: 12px;
  line-height: 1.5;

  svg {
    margin-top: 1px;
    color: var(--danger);
  }
}

.update-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  padding-top: 2px;
}

.update-primary {
  min-width: 132px;
}

@keyframes update-progress {
  from {
    transform: translateX(0);
  }

  to {
    transform: translateX(390%);
  }
}

@media (max-width: 600px) {
  .update-backdrop {
    padding: 14px;
  }

  .update-modal {
    max-height: calc(100vh - 28px);
    padding: 20px;
  }

  .update-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));

    > :only-child {
      grid-column: 1 / -1;
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .update-progress-track.indeterminate::after {
    animation: none;
    inset: 0;
    width: 100%;
    opacity: 0.55;
  }
}
</style>
