<script setup lang="ts">
import { Layers3, X } from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, useTemplateRef } from "vue";

const props = defineProps<{
  cost: number;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const dialog = useTemplateRef<HTMLElement>("dialog");
const totalCost = computed(() => props.cost * 2);
let previouslyFocused: HTMLElement | null = null;

onMounted(() => {
  previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.value?.focus();
});

onBeforeUnmount(() => previouslyFocused?.focus());

function trapFocus(event: KeyboardEvent) {
  const focusable = dialog.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
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
  <div class="modal-backdrop split-backdrop" @click.self="emit('cancel')">
    <Transition name="modal" appear>
      <section
        ref="dialog"
        class="modal split-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-layer-split-title"
        aria-describedby="auto-layer-split-description"
        tabindex="-1"
        @keydown.esc="emit('cancel')"
        @keydown.tab="trapFocus"
      >
        <button class="icon-button split-close" type="button" aria-label="关闭" @click="emit('cancel')">
          <X :size="18" aria-hidden="true" />
        </button>

        <div class="split-heading">
          <span class="split-icon" aria-hidden="true"><Layers3 :size="21" /></span>
          <div>
            <h2 id="auto-layer-split-title">云端修复需要拆分任务</h2>
            <p id="auto-layer-split-description">图片与父级背景超出单次云端修复容量。</p>
          </div>
        </div>

        <p class="split-note">
          将拆成「整页背景」和「父级素材」两张图集分别修复，每张保持更高清晰度。
          本次消耗 <strong>{{ totalCost }} 积分（{{ cost }} × 2）</strong>。
        </p>

        <footer class="split-actions">
          <button class="ghost-button" type="button" @click="emit('cancel')">取消</button>
          <button class="primary-small" type="button" @click="emit('confirm')">
            确认拆分并继续
          </button>
        </footer>
      </section>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.split-backdrop { z-index: 110; }
.split-modal {
  width: min(440px, 100%);
  display: grid;
  gap: 18px;
  padding: 22px;
}
.split-modal:focus { outline: none; }
.split-close { position: absolute; top: 14px; right: 14px; }
.split-heading {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: start;
  gap: 13px;
  padding-right: 36px;
}
.split-heading h2 { margin: 0; font-size: 17px; letter-spacing: 0; }
.split-heading p { margin: 6px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.split-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  color: var(--accent-strong);
  background: var(--accent-soft);
}
.split-note { margin: 0; padding: 12px 0; border-block: 1px solid var(--line); color: var(--muted); font-size: 11px; line-height: 1.7; }
.split-note strong { color: var(--text); }
.split-actions { display: flex; justify-content: flex-end; gap: 8px; }
.split-actions button { min-width: 120px; }
@media (max-width: 480px) {
  .split-modal { padding: 18px; }
  .split-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .split-actions button { width: 100%; }
}
</style>
