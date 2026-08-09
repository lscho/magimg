<script setup lang="ts">
import { computed, onMounted, shallowRef, useTemplateRef } from "vue";
import { Save, X } from "lucide-vue-next";
import type { CompressionSettings } from "@/types";

const emit = defineEmits<{ close: [] }>();
const settings = defineModel<CompressionSettings>({ required: true });
const dialog = useTemplateRef<HTMLElement>("dialog");
const draft = shallowRef<CompressionSettings>({ ...settings.value });

function setting<K extends keyof CompressionSettings>(key: K) {
  return computed({
    get: () => draft.value[key],
    set: (value: CompressionSettings[K]) => {
      draft.value = { ...draft.value, [key]: value };
    }
  });
}

const conflictPolicy = setting("conflictPolicy");
const skipNoBenefit = setting("skipNoBenefit");

onMounted(() => dialog.value?.focus());

function save() {
  settings.value = { ...draft.value };
  emit("close");
}
</script>

<template>
  <div class="modal-backdrop compression-dialog-backdrop" @click.self="emit('close')">
    <Transition name="modal" appear>
      <section
        ref="dialog"
        class="modal compression-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compression-dialog-title"
        tabindex="-1"
        @keydown.esc="emit('close')"
      >
        <header class="dialog-header">
          <div>
            <h2 id="compression-dialog-title">压缩设置</h2>
            <p>配置输出文件的处理方式。</p>
          </div>
          <button class="icon-button" type="button" aria-label="关闭压缩设置" @click="emit('close')">
            <X :size="18" aria-hidden="true" />
          </button>
        </header>

        <form class="dialog-form" @submit.prevent="save">
          <div class="dialog-body">
            <section class="dialog-section" aria-labelledby="output-behavior-title">
              <h3 id="output-behavior-title">输出处理</h3>
              <label class="field-group" for="compression-conflict">
                <span>同名文件</span>
                <select id="compression-conflict" v-model="conflictPolicy">
                  <option value="rename">自动重命名</option>
                  <option value="skip">跳过并报告</option>
                  <option value="overwrite">覆盖已有输出</option>
                </select>
              </label>
              <label class="switch-row" for="compression-no-benefit">
                <span>
                  <strong>无压缩收益时不写出</strong>
                  <small>压缩后文件不小于原文件时保留原图。</small>
                </span>
                <input
                  id="compression-no-benefit"
                  v-model="skipNoBenefit"
                  class="settings-switch"
                  type="checkbox"
                  role="switch"
                  :aria-checked="skipNoBenefit"
                />
              </label>
            </section>
          </div>

          <footer class="dialog-footer">
            <button class="ghost-button" type="button" @click="emit('close')">取消</button>
            <button class="primary-small" type="submit">
              <Save :size="15" aria-hidden="true" />
              保存设置
            </button>
          </footer>
        </form>
      </section>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.compression-dialog {
  width: min(640px, 100%);
  max-height: calc(100vh - 48px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 0;
  overflow: hidden;

  &:focus { outline: none; }
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 22px 17px;
  border-bottom: 1px solid var(--line);

  h2 { margin: 0; }
  p { margin: 6px 0 0; font-size: 11px; }
}

.dialog-form {
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}

.dialog-body {
  min-height: 0;
  overflow: auto;
}

.dialog-section {
  display: grid;
  gap: 14px;
  padding: 18px 22px 20px;
  border-bottom: 1px solid var(--line);

  &:last-child { border-bottom: 0; }

  h3 {
    margin: 0;
    color: var(--text);
    font-size: 12px;
    font-weight: 680;
  }
}

.field-group {
  display: grid;
  gap: 7px;
  margin: 0;

  > span {
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
  }
}

.switch-row {
  min-height: 48px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  margin: 0;
  padding-top: 14px;
  border-top: 1px solid var(--line);

  > span { display: grid; gap: 4px; }
  strong { color: var(--soft); font-size: 11px; font-weight: 620; }
  small { color: var(--muted); font-size: 10px; font-weight: 500; }

}

.settings-switch {
  position: relative;
  width: 42px;
  height: 24px;
  appearance: none;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: var(--field);
  cursor: pointer;

  &::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--muted);
    transition: transform 160ms ease, background 160ms ease;
  }

  &:checked {
    border-color: var(--accent);
    background: var(--accent-soft);

    &::after { transform: translateX(18px); background: var(--accent-strong); }
  }
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px 18px;
  border-top: 1px solid var(--line);
  background: #0d131a;
}

@media (max-width: 700px) {
  .compression-dialog-backdrop { padding: 12px; }
  .dialog-header,
  .dialog-section { padding-right: 16px; padding-left: 16px; }
  .dialog-footer { padding-right: 16px; padding-left: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .settings-switch::after { transition: none; }
}
</style>
