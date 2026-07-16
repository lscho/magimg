<script setup lang="ts">
import { onMounted, reactive, useTemplateRef } from "vue";
import { FolderOpen, LogOut, Save, X } from "lucide-vue-next";
import { chooseDirectory } from "@/services/desktop";
import { useAppStore } from "@/stores/app";
import type { AppSettings } from "@/types";

const emit = defineEmits<{ close: [] }>();
const app = useAppStore();
const dialog = useTemplateRef<HTMLElement>("dialog");
const draft = reactive<AppSettings>({ ...app.settings, defaultParams: { ...app.settings.defaultParams } });

onMounted(() => {
  dialog.value?.focus();
});

async function pickDirectory() {
  const selected = await chooseDirectory();
  if (selected) draft.saveDirectory = selected;
}

async function save() {
  await app.saveSettings({ ...draft, defaultParams: { ...draft.defaultParams } });
  emit("close");
}

async function logout() {
  await app.logout();
  emit("close");
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <Transition name="modal" appear>
      <section
        ref="dialog"
        class="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        tabindex="-1"
        @keydown.esc="emit('close')"
      >
        <header class="settings-modal-header">
          <div>
            <span class="section-kicker">PREFERENCES</span>
            <h2 id="settings-modal-title">应用设置</h2>
            <p>管理图片保存方式和创作默认值。</p>
          </div>
          <button class="icon-button settings-modal-close" type="button" aria-label="关闭设置" @click="emit('close')">
            <X :size="18" />
          </button>
        </header>

        <form class="settings-modal-form" @submit.prevent="save">
          <div class="settings-modal-body">
            <section class="settings-group">
              <div class="settings-fields">
                <div class="settings-directory-field">
                  <label class="settings-directory-label" for="settings-save-directory">
                    <span class="settings-field-label">存储目录</span>
                    <span class="settings-field-help">生成完成的图片将保存到这个目录。</span>
                  </label>
                  <div class="settings-directory-control">
                    <input
                      id="settings-save-directory"
                      v-model="draft.saveDirectory"
                      type="text"
                      placeholder="请选择本地存储目录"
                    />
                    <button class="ghost-button settings-directory-button" type="button" @click="pickDirectory">
                      <FolderOpen :size="16" />
                      选择目录
                    </button>
                  </div>
                </div>

                <label class="settings-toggle-row" for="settings-auto-save">
                  <span class="settings-toggle-copy">
                    <span class="settings-field-label">自动保存生成图片</span>
                    <span class="settings-field-help">图片生成完成后自动保存到上方目录。</span>
                  </span>
                  <input
                    id="settings-auto-save"
                    v-model="draft.autoSave"
                    class="settings-switch"
                    type="checkbox"
                    role="switch"
                    :aria-checked="draft.autoSave"
                  />
                </label>
              </div>
            </section>

            <section class="settings-group">
              <div class="settings-fields">
                <label class="settings-prompt-field" for="settings-default-prompt">
                  <span class="settings-field-label">默认提示词</span>
                  <span class="settings-field-help">新建创作时会自动填入，你仍可在生成前修改。</span>
                  <textarea id="settings-default-prompt" v-model="draft.defaultParams.prompt" />
                </label>
              </div>
            </section>
          </div>

          <footer class="settings-modal-footer">
            <button v-if="app.isAuthenticated" class="ghost-button danger settings-logout-button" type="button" @click="logout">
              <LogOut :size="16" />
              退出登录
            </button>
            <div class="settings-modal-actions">
              <button class="ghost-button settings-cancel-button" type="button" @click="emit('close')">取消</button>
              <button class="primary-small" type="submit">
                <Save :size="16" />
                保存设置
              </button>
            </div>
          </footer>
        </form>
      </section>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.modal.settings-modal {
  width: min(620px, 100%);
  max-height: calc(100vh - 48px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 0;
  overflow: hidden;

  &:focus {
    outline: none;
  }
}

.settings-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 22px 18px;
  border-bottom: 1px solid var(--line);

  h2 {
    margin: 4px 0 0;
    color: var(--text);
    font-size: 18px;
    font-weight: 660;
  }

  p {
    margin: 7px 0 0;
    font-size: 11px;
    line-height: 1.5;
  }
}

.settings-modal-close {
  flex: 0 0 auto;
}

.settings-modal-form {
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}

.settings-modal-body {
  min-height: 0;
  display: grid;
  gap: 20px;
  overflow: auto;
  padding: 20px 22px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.settings-group {
  display: grid;
  gap: 14px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--line);

  &:last-child {
    padding-bottom: 0;
    border-bottom: 0;
  }
}

.settings-fields {
  display: grid;
  gap: 14px;

  label {
    display: grid;
    gap: 7px;
    margin: 0;
  }

  .settings-directory-field,
  .settings-prompt-field {
    display: grid;
    gap: 8px;
  }
}

.settings-directory-label {
  display: grid;
  gap: 4px;
}

.settings-field-label {
  color: var(--text);
  font-size: 12px;
  font-weight: 650;
}

.settings-field-help {
  color: var(--muted);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.5;
}

.settings-directory-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.settings-directory-button {
  width: auto;
  height: 42px;
  padding: 0 13px;
  white-space: nowrap;
}

.settings-toggle-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}

.settings-toggle-copy {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.settings-switch {
  position: relative;
  width: 44px;
  height: 24px;
  flex: 0 0 auto;
  appearance: none;
  padding: 0;
  border-color: var(--line-strong);
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
    background: #aab3c0;
    transition:
      transform 0.18s ease,
      background 0.18s ease;
  }

  &:checked {
    border-color: var(--accent);
    background: var(--accent);

    &::after {
      background: var(--on-accent);
      transform: translateX(20px);
    }
  }
}

.settings-prompt-field textarea {
  min-height: 110px;
  padding: 12px 13px;
  line-height: 1.6;
}

.settings-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--line);
  background: #0d131a;

  .primary-small {
    height: 38px;
    padding: 0 16px;
  }
}

.settings-modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.settings-logout-button {
  width: auto;
  height: 38px;
  padding: 0 13px;
  color: var(--danger);

  &:hover {
    color: #ff9ba4;
    border-color: rgba(239, 125, 136, 0.5);
    background: rgba(239, 125, 136, 0.09);
  }
}

.settings-cancel-button {
  width: auto;
  height: 38px;
  padding: 0 16px;
}

@media (max-width: 600px) {
  .modal.settings-modal {
    max-height: calc(100vh - 24px);
  }

  .settings-modal-header {
    padding: 18px 18px 15px;
  }

  .settings-modal-body {
    padding: 17px 18px;
  }

  .settings-directory-control {
    grid-template-columns: 1fr;
  }

  .settings-directory-button {
    width: 100%;
  }

  .settings-modal-footer {
    align-items: stretch;
    flex-wrap: wrap;
    padding: 13px 18px;
  }

  .settings-modal-actions {
    margin-left: auto;
  }
}
</style>
