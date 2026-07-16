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
              <div class="settings-group-heading">
                <h3>文件保存</h3>
                <p>设置生成图片的本地保存位置和保存方式。</p>
              </div>

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
              <div class="settings-group-heading">
                <h3>创作默认值</h3>
                <p>设置每次新建创作时自动填入的内容。</p>
              </div>

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
