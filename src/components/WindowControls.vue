<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from "vue";
import { Copy, Minus, Square, X } from "lucide-vue-next";
import {
  closeAppWindow,
  hasWindowsWindowControls,
  isAppWindowMaximized,
  minimizeAppWindow,
  onAppWindowResized,
  toggleAppWindowMaximized
} from "@/services/desktop";

const isWindows = hasWindowsWindowControls();
const isMaximized = shallowRef(false);
let isMounted = false;
let stopResizeListener: (() => void) | undefined;

async function syncMaximizedState() {
  isMaximized.value = await isAppWindowMaximized();
}

async function minimizeWindow() {
  await minimizeAppWindow();
}

async function toggleMaximized() {
  isMaximized.value = await toggleAppWindowMaximized();
}

async function closeWindow() {
  await closeAppWindow();
}

onMounted(async () => {
  if (!isWindows) return;
  isMounted = true;
  await syncMaximizedState();

  const unlisten = await onAppWindowResized(() => {
    void syncMaximizedState();
  });
  if (!isMounted) {
    unlisten();
    return;
  }
  stopResizeListener = unlisten;
});

onBeforeUnmount(() => {
  isMounted = false;
  stopResizeListener?.();
});
</script>

<template>
  <div v-if="isWindows" class="window-controls" role="group" aria-label="窗口控制">
    <button
      class="window-control"
      type="button"
      aria-label="最小化窗口"
      title="最小化"
      @click="minimizeWindow"
    >
      <Minus :size="15" :stroke-width="1.7" aria-hidden="true" />
    </button>
    <button
      class="window-control"
      type="button"
      :aria-label="isMaximized ? '还原窗口' : '最大化窗口'"
      :title="isMaximized ? '还原' : '最大化'"
      @click="toggleMaximized"
    >
      <Copy v-if="isMaximized" :size="13" :stroke-width="1.6" aria-hidden="true" />
      <Square v-else :size="13" :stroke-width="1.6" aria-hidden="true" />
    </button>
    <button
      class="window-control window-control-close"
      type="button"
      aria-label="关闭窗口"
      title="关闭"
      @click="closeWindow"
    >
      <X :size="16" :stroke-width="1.7" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.window-controls {
  position: relative;
  z-index: 2;
  height: 100%;
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 46px);
  align-self: stretch;
  margin: 0 -12px 0 8px;
}

.window-control {
  width: 46px;
  height: 100%;
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 0;
  color: var(--soft);
  background: transparent;
  transition:
    color 0.16s ease,
    background 0.16s ease;

  &:hover {
    color: var(--text);
    background: var(--surface-strong);
  }

  &:active {
    background: var(--surface-subtle);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }

  &-close:hover,
  &-close:focus-visible {
    color: var(--text);
    background: var(--window-close-hover);
  }

  &-close:active {
    background: var(--window-close-active);
  }
}

@media (prefers-reduced-motion: reduce) {
  .window-control {
    transition: none;
  }
}
</style>
