<script setup lang="ts">
import { onBeforeUnmount, shallowRef, useTemplateRef } from "vue";

const props = withDefaults(defineProps<{
  value: number;
  min?: number;
  max?: number;
}>(), {
  min: 25,
  max: 75
});

const emit = defineEmits<{
  resize: [value: number];
  draggingChange: [dragging: boolean];
}>();

const handle = useTemplateRef<HTMLElement>("handle");
const dragging = shallowRef(false);

function clamp(value: number) {
  return Math.min(props.max, Math.max(props.min, value));
}

function resizeFromPointer(event: PointerEvent) {
  const container = handle.value?.parentElement;
  if (!container) return;
  const bounds = container.getBoundingClientRect();
  if (bounds.width <= 0) return;
  emit("resize", clamp((event.clientX - bounds.left) / bounds.width * 100));
}

function startDragging(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging.value = true;
  emit("draggingChange", true);
  resizeFromPointer(event);
  window.addEventListener("pointermove", resizeFromPointer);
  window.addEventListener("pointerup", stopDragging, { once: true });
  window.addEventListener("pointercancel", stopDragging, { once: true });
}

function stopDragging() {
  if (!dragging.value) return;
  dragging.value = false;
  emit("draggingChange", false);
  window.removeEventListener("pointermove", resizeFromPointer);
  window.removeEventListener("pointerup", stopDragging);
  window.removeEventListener("pointercancel", stopDragging);
}

function handleKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? 5 : 2;
  let next = props.value;
  if (event.key === "ArrowLeft") next -= step;
  else if (event.key === "ArrowRight") next += step;
  else if (event.key === "Home") next = props.min;
  else if (event.key === "End") next = props.max;
  else return;
  event.preventDefault();
  emit("resize", clamp(next));
}

onBeforeUnmount(stopDragging);
</script>

<template>
  <div
    ref="handle"
    class="auto-layer-split-handle"
    :class="{ dragging }"
    role="separator"
    aria-label="调整原图和分层结果宽度"
    aria-orientation="vertical"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="Math.round(value)"
    :aria-valuetext="`原图宽度 ${Math.round(value)}%`"
    tabindex="0"
    @pointerdown="startDragging"
    @keydown="handleKeydown"
  >
    <span aria-hidden="true" />
  </div>
</template>

<style scoped lang="scss">
.auto-layer-split-handle {
  position: relative;
  z-index: 4;
  width: 100%;
  min-width: 0;
  height: 100%;
  display: grid;
  place-items: center;
  cursor: col-resize;
  touch-action: none;
  opacity: 0;
  pointer-events: none;
  background: var(--surface);
  transition: opacity 160ms ease;
}
.auto-layer-split-handle::before {
  position: absolute;
  inset: 0 3px;
  content: "";
  background: var(--line);
  transition: background 160ms ease;
}
.auto-layer-split-handle span {
  position: relative;
  width: 3px;
  height: 32px;
  border-radius: 2px;
  background: var(--line-strong);
  transition: height 160ms ease, background 160ms ease;
}
.auto-layer-split-handle:hover::before,
.auto-layer-split-handle.dragging::before { background: var(--accent-border); }
.auto-layer-split-handle:hover span,
.auto-layer-split-handle.dragging span { height: 44px; background: var(--accent-strong); }
.auto-layer-split-handle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) {
  .auto-layer-split-handle,
  .auto-layer-split-handle::before,
  .auto-layer-split-handle span { transition: none; }
}
</style>
