<script setup lang="ts">
import { Download, HardDrive, X } from "lucide-vue-next";
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue";

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const dialog = useTemplateRef<HTMLElement>("dialog");
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
  <div class="modal-backdrop resource-backdrop" @click.self="emit('cancel')">
    <Transition name="modal" appear>
      <section
        ref="dialog"
        class="modal resource-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auto-layer-resource-title"
        aria-describedby="auto-layer-resource-description"
        tabindex="-1"
        @keydown.esc="emit('cancel')"
        @keydown.tab="trapFocus"
      >
        <button class="icon-button resource-close" type="button" aria-label="关闭" @click="emit('cancel')">
          <X :size="18" aria-hidden="true" />
        </button>

        <div class="resource-heading">
          <span class="resource-icon" aria-hidden="true"><HardDrive :size="21" /></span>
          <div>
            <h2 id="auto-layer-resource-title">下载自动分层资源</h2>
            <p id="auto-layer-resource-description">首次使用一键分层功能需要下载资源包。</p>
          </div>
        </div>

        <p class="resource-note">资源包含文字识别与元素命名模型，下载后保存在本机，后续无需重复下载。</p>

        <footer class="resource-actions">
          <button class="ghost-button" type="button" @click="emit('cancel')">取消</button>
          <button class="primary-small" type="button" @click="emit('confirm')">
            <Download :size="16" aria-hidden="true" />
            下载并继续
          </button>
        </footer>
      </section>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.resource-backdrop { z-index: 110; }
.resource-modal {
  width: min(440px, 100%);
  display: grid;
  gap: 18px;
  padding: 22px;
}
.resource-modal:focus { outline: none; }
.resource-close { position: absolute; top: 14px; right: 14px; }
.resource-heading {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  align-items: start;
  gap: 13px;
  padding-right: 36px;
}
.resource-heading h2 { margin: 0; font-size: 17px; letter-spacing: 0; }
.resource-heading p { margin: 6px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
.resource-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  color: var(--accent-strong);
  background: var(--accent-soft);
}
.resource-note { margin: 0; padding: 12px 0; border-block: 1px solid var(--line); color: var(--muted); font-size: 11px; line-height: 1.7; }
.resource-actions { display: flex; justify-content: flex-end; gap: 8px; }
.resource-actions button { min-width: 86px; }
@media (max-width: 480px) {
  .resource-modal { padding: 18px; }
  .resource-actions { display: grid; grid-template-columns: 1fr 1fr; }
  .resource-actions button { width: 100%; }
}
</style>
