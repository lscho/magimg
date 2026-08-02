<script setup lang="ts">
import { computed, onMounted, shallowRef, useTemplateRef } from "vue";
import { Save, X } from "lucide-vue-next";
import type { CompressionSettings } from "@/types";

const emit = defineEmits<{ close: [] }>();
const settings = defineModel<CompressionSettings>({ required: true });
const dialog = useTemplateRef<HTMLElement>("dialog");
const draft = shallowRef<CompressionSettings>({ ...settings.value });
const activeFormat = shallowRef<"png" | "jpeg" | "webp">("png");

function setting<K extends keyof CompressionSettings>(key: K) {
  return computed({
    get: () => draft.value[key],
    set: (value: CompressionSettings[K]) => {
      draft.value = { ...draft.value, [key]: value };
    }
  });
}

const pngLevel = setting("pngLevel");
const jpegQuality = setting("jpegQuality");
const jpegProgressive = setting("jpegProgressive");
const webpMode = setting("webpMode");
const webpQuality = setting("webpQuality");
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
            <p>配置文件冲突处理和各格式编码参数。</p>
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
                  <small>候选文件不小于原文件时保留原图。</small>
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

            <section class="dialog-section format-section" aria-labelledby="format-settings-title">
              <h3 id="format-settings-title">格式设置</h3>
              <div class="format-tabs" role="tablist" aria-label="图片格式设置">
                <button
                  v-for="format in ['png', 'jpeg', 'webp'] as const"
                  :id="`compression-${format}-tab`"
                  :key="format"
                  type="button"
                  role="tab"
                  :aria-controls="`compression-${format}-panel`"
                  :aria-selected="activeFormat === format"
                  :class="{ active: activeFormat === format }"
                  @click="activeFormat = format"
                >
                  {{ format.toUpperCase() }}
                </button>
              </div>

              <div
                v-if="activeFormat === 'png'"
                id="compression-png-panel"
                class="format-options"
                role="tabpanel"
                aria-labelledby="compression-png-tab"
              >
                <label class="field-group" for="png-level">
                  <span>无损优化</span>
                  <select id="png-level" v-model="pngLevel">
                    <option value="fast">快速</option>
                    <option value="balanced">均衡</option>
                    <option value="maximum">最大</option>
                  </select>
                </label>
              </div>

              <div
                v-else-if="activeFormat === 'jpeg'"
                id="compression-jpeg-panel"
                class="format-options"
                role="tabpanel"
                aria-labelledby="compression-jpeg-tab"
              >
                <div class="range-heading">
                  <label for="jpeg-quality">质量</label>
                  <output for="jpeg-quality">{{ jpegQuality }}</output>
                </div>
                <input id="jpeg-quality" v-model.number="jpegQuality" type="range" min="1" max="100" />
                <label class="switch-row compact" for="jpeg-progressive">
                  <span><strong>渐进式 JPEG</strong></span>
                  <input
                    id="jpeg-progressive"
                    v-model="jpegProgressive"
                    class="settings-switch"
                    type="checkbox"
                    role="switch"
                    :aria-checked="jpegProgressive"
                  />
                </label>
                <p class="setting-note">{{ jpegQuality < 90 ? "色度采样 4:2:0" : "色度采样 4:4:4" }}</p>
              </div>

              <div
                v-else
                id="compression-webp-panel"
                class="format-options"
                role="tabpanel"
                aria-labelledby="compression-webp-tab"
              >
                <label class="field-group" for="webp-mode">
                  <span>压缩模式</span>
                  <select id="webp-mode" v-model="webpMode">
                    <option value="lossy">有损</option>
                    <option value="lossless">无损</option>
                  </select>
                </label>
                <template v-if="webpMode === 'lossy'">
                  <div class="range-heading">
                    <label for="webp-quality">质量</label>
                    <output for="webp-quality">{{ webpQuality }}</output>
                  </div>
                  <input id="webp-quality" v-model.number="webpQuality" type="range" min="1" max="100" />
                </template>
              </div>
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

  &.compact {
    min-height: 40px;
    padding-top: 10px;
  }
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

.format-tabs {
  height: 36px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--field);

  button {
    border-radius: 5px;
    color: var(--muted);
    background: transparent;
    font-size: 10px;
    font-weight: 700;

    &.active { color: var(--accent-strong); background: var(--surface-strong); }
  }
}

.format-options {
  min-height: 114px;
  display: grid;
  align-content: start;
  gap: 11px;
  padding-top: 2px;

  input[type="range"] {
    height: 20px;
    padding: 0;
    border: 0;
    box-shadow: none;
    accent-color: var(--accent);
  }
}

.range-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;

  output { color: var(--text); font-variant-numeric: tabular-nums; }
}

.setting-note { margin: 0; color: var(--muted); font-size: 10px; }

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
