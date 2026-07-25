<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch
} from "vue";
import { Clipboard, Download, LoaderCircle } from "lucide-vue-next";

const props = defineProps<{
  copying: boolean;
  saving: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
  copy: [];
  save: [];
}>();

const menu = useTemplateRef<HTMLElement>("menu");
const left = shallowRef(props.x);
const top = shallowRef(props.y);
const VIEWPORT_MARGIN = 8;

function enabledItems() {
  if (!menu.value) return [];
  return Array.from(menu.value.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
}

async function positionMenu() {
  left.value = props.x;
  top.value = props.y;
  await nextTick();
  if (!menu.value) return;

  const bounds = menu.value.getBoundingClientRect();
  left.value = Math.min(
    Math.max(VIEWPORT_MARGIN, props.x),
    Math.max(VIEWPORT_MARGIN, window.innerWidth - bounds.width - VIEWPORT_MARGIN)
  );
  top.value = Math.min(
    Math.max(VIEWPORT_MARGIN, props.y),
    Math.max(VIEWPORT_MARGIN, window.innerHeight - bounds.height - VIEWPORT_MARGIN)
  );
  await nextTick();
  enabledItems()[0]?.focus();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
    return;
  }

  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = enabledItems();
  if (!items.length) return;
  event.preventDefault();
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : event.key === "ArrowDown"
        ? (currentIndex + 1 + items.length) % items.length
        : (currentIndex - 1 + items.length) % items.length;
  items[nextIndex]?.focus();
}

onMounted(() => {
  void positionMenu();
  window.addEventListener("resize", positionMenu);
});

watch(
  () => [props.x, props.y],
  () => void positionMenu()
);

onBeforeUnmount(() => {
  window.removeEventListener("resize", positionMenu);
});
</script>

<template>
  <div
    ref="menu"
    class="image-context-menu"
    data-image-editor-image-menu
    role="menu"
    aria-label="图片操作"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @contextmenu.prevent
    @keydown="handleKeydown"
  >
    <button
      type="button"
      role="menuitem"
      :disabled="copying"
      @click="emit('copy')"
    >
      <LoaderCircle v-if="copying" class="menu-spinner" :size="15" aria-hidden="true" />
      <Clipboard v-else :size="15" aria-hidden="true" />
      <span>复制</span>
    </button>
    <button
      type="button"
      role="menuitem"
      :disabled="saving"
      @click="emit('save')"
    >
      <LoaderCircle v-if="saving" class="menu-spinner" :size="15" aria-hidden="true" />
      <Download v-else :size="15" aria-hidden="true" />
      <span>另存为</span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.image-context-menu {
  position: fixed;
  z-index: 6;
  min-width: 148px;
  padding: 4px;
  border: 1px solid var(--line-strong);
  border-radius: 7px;
  background: var(--surface-strong, var(--surface));
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.46);

  button {
    width: 100%;
    min-height: 34px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 9px;
    border: 0;
    border-radius: 5px;
    color: var(--soft);
    background: transparent;
    font-size: 11px;
    font-weight: 600;
    text-align: left;

    &:hover:not(:disabled),
    &:focus-visible {
      color: var(--accent-strong);
      background: var(--accent-soft);
      outline: none;
    }

    &:disabled {
      opacity: 0.48;
    }
  }
}

.menu-spinner {
  animation: spin 0.9s linear infinite;
}
</style>
