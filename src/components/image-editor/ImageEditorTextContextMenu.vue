<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch
} from "vue";
import { Trash2 } from "lucide-vue-next";

const props = defineProps<{
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  close: [];
  delete: [];
}>();

const menu = useTemplateRef<HTMLElement>("menu");
const deleteButton = useTemplateRef<HTMLButtonElement>("deleteButton");
const left = shallowRef(props.x);
const top = shallowRef(props.y);
const VIEWPORT_MARGIN = 8;

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
  deleteButton.value?.focus();
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close");
    return;
  }

  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    deleteButton.value?.focus();
  }
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
    class="text-context-menu"
    data-image-editor-text-menu
    role="menu"
    aria-label="文字操作"
    :style="{ left: `${left}px`, top: `${top}px` }"
    @contextmenu.prevent
    @keydown="handleKeydown"
  >
    <button
      ref="deleteButton"
      type="button"
      role="menuitem"
      aria-label="删除文字"
      @click="emit('delete')"
    >
      <Trash2 :size="15" aria-hidden="true" />
      <span>删除文字</span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.text-context-menu {
  position: fixed;
  z-index: 4;
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

    &:hover,
    &:focus-visible {
      color: var(--danger);
      background: rgba(239, 125, 136, 0.12);
      outline: none;
    }
  }
}
</style>
