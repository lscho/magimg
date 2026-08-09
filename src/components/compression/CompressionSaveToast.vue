<script setup lang="ts">
import { CircleCheck, X } from "lucide-vue-next";

defineProps<{ message: string }>();

const emit = defineEmits<{
  dismiss: [];
}>();
</script>

<template>
  <div class="compression-save-toast" role="status" aria-live="polite">
    <CircleCheck :size="18" aria-hidden="true" />
    <span>{{ message }}</span>
    <button type="button" aria-label="关闭保存提醒" @click="emit('dismiss')">
      <X :size="15" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.compression-save-toast {
  position: absolute;
  z-index: 8;
  top: 16px;
  left: calc((100% - 340px) / 2);
  width: min(360px, calc(100% - 372px));
  min-height: 46px;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 9px;
  padding: 8px 8px 8px 12px;
  border: 1px solid rgba(101, 211, 173, 0.4);
  border-radius: 7px;
  color: var(--soft);
  background: var(--surface-raised);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.38);
  transform: translateX(-50%);
  animation: compression-toast-in 160ms ease-out;

  > svg { color: var(--success); }

  span {
    overflow-wrap: anywhere;
    font-size: 11px;
    font-weight: 620;
    line-height: 1.45;
  }

  button {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--muted);
    background: transparent;

    &:hover { border-color: var(--line); color: var(--text); background: var(--field); }
    &:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  }
}

@keyframes compression-toast-in {
  from { opacity: 0; transform: translate(-50%, -6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

@media (max-width: 900px) {
  .compression-save-toast {
    position: fixed;
    top: 62px;
    left: 50%;
    width: min(360px, calc(100% - 28px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .compression-save-toast { animation: none; transform: translateX(-50%); }
}
</style>
