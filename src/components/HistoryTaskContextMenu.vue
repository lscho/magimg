<script setup lang="ts">
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";
import { Clipboard, Download, ExternalLink, ImagePlus } from "lucide-vue-next";

defineProps<{
  x: number;
  y: number;
  hasImage: boolean;
}>();

const emit = defineEmits<{
  close: [];
  openTask: [];
  copy: [];
  download: [];
  useAsReference: [];
}>();

const menu = useTemplateRef<HTMLElement>("menu");
let previousFocus: HTMLElement | null = null;

function closeFromOutside(event: PointerEvent) {
  if (!menu.value?.contains(event.target as Node)) emit("close");
}

function closeForViewportChange() {
  emit("close");
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
    return;
  }

  const buttons = Array.from(
    menu.value?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []
  );
  if (!buttons.length) return;
  const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let nextIndex: number | null = null;
  if (event.key === "ArrowDown") {
    nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % buttons.length;
  }
  if (event.key === "ArrowUp") {
    nextIndex = currentIndex === -1 ? buttons.length - 1 : (currentIndex - 1 + buttons.length) % buttons.length;
  }
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = buttons.length - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  buttons[nextIndex]?.focus();
}

onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  menu.value?.focus();
  document.addEventListener("pointerdown", closeFromOutside);
  window.addEventListener("blur", closeForViewportChange);
  window.addEventListener("resize", closeForViewportChange);
  window.addEventListener("scroll", closeForViewportChange, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeFromOutside);
  window.removeEventListener("blur", closeForViewportChange);
  window.removeEventListener("resize", closeForViewportChange);
  window.removeEventListener("scroll", closeForViewportChange, true);
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>

<template>
  <div
    ref="menu"
    class="history-task-context-menu"
    role="menu"
    aria-label="历史任务菜单"
    tabindex="-1"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @contextmenu.prevent
    @keydown="handleKeydown"
  >
    <button type="button" role="menuitem" @click="emit('openTask')">
      <ExternalLink :size="15" aria-hidden="true" />
      <span>打开任务</span>
    </button>
    <button type="button" role="menuitem" :disabled="!hasImage" @click="emit('copy')">
      <Clipboard :size="15" aria-hidden="true" />
      <span>复制</span>
    </button>
    <button type="button" role="menuitem" :disabled="!hasImage" @click="emit('download')">
      <Download :size="15" aria-hidden="true" />
      <span>保存</span>
    </button>
    <button type="button" role="menuitem" :disabled="!hasImage" @click="emit('useAsReference')">
      <ImagePlus :size="15" aria-hidden="true" />
      <span>图生图</span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.history-task-context-menu {
  position: fixed;
  z-index: 30;
  width: 168px;
  display: grid;
  gap: 2px;
  padding: 5px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background: rgba(21, 29, 39, 0.97);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.38);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  outline: none;

  button {
    width: 100%;
    min-height: 34px;
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 0 9px;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--soft);
    background: transparent;
    font-size: 12px;
    font-weight: 600;
    text-align: left;
    transition:
      color 0.16s ease,
      border-color 0.16s ease,
      background 0.16s ease;

    &:hover,
    &:focus-visible {
      border-color: var(--accent-border);
      color: var(--text);
      background: var(--surface-strong);
      outline: none;
    }

    &:disabled {
      color: var(--muted);
      cursor: not-allowed;
      opacity: 0.48;
    }

    &:disabled:hover {
      border-color: transparent;
      background: transparent;
    }

    svg {
      color: var(--tech-cyan);
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .history-task-context-menu button {
    transition: none;
  }
}
</style>
