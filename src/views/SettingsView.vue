<script setup lang="ts">
import { reactive, watch } from "vue";
import { FolderOpen, Save } from "lucide-vue-next";
import { chooseDirectory } from "@/services/desktop";
import { useAppStore } from "@/stores/app";
import type { AppSettings } from "@/types";

const app = useAppStore();
const draft = reactive<AppSettings>({ ...app.settings, defaultParams: { ...app.settings.defaultParams } });

watch(
  () => app.settings,
  (settings) => {
    Object.assign(draft, { ...settings, defaultParams: { ...settings.defaultParams } });
  },
  { deep: true }
);

async function pickDirectory() {
  const selected = await chooseDirectory();
  if (selected) draft.saveDirectory = selected;
}

async function save() {
  await app.saveSettings({ ...draft, defaultParams: { ...draft.defaultParams } });
}
</script>

<template>
  <section class="page-view settings-view">
    <div class="page-heading">
      <div>
        <span class="section-kicker">PREFERENCES</span>
        <h1>应用设置</h1>
        <p>管理图片保存方式和创作默认值。</p>
      </div>
      <button class="primary-small" type="submit" form="settings-form">
        <Save :size="16" />
        保存设置
      </button>
    </div>

    <form id="settings-form" class="settings-form" @submit.prevent="save">
      <section class="settings-group">
        <div class="settings-group-heading">
          <h2>文件保存</h2>
          <p>设置生成图片的本地保存位置和保存方式。</p>
        </div>

        <div class="settings-fields">
          <div class="settings-directory-field">
            <label class="settings-directory-label" for="save-directory">
              <span class="settings-field-label">存储目录</span>
              <span class="settings-field-help">生成完成的图片将保存到这个目录。</span>
            </label>
            <div class="settings-directory-control">
              <input
                id="save-directory"
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

          <label class="settings-toggle-row" for="auto-save">
            <span class="settings-toggle-copy">
              <span class="settings-field-label">自动保存生成图片</span>
              <span class="settings-field-help">图片生成完成后自动保存到上方目录。</span>
            </span>
            <input
              id="auto-save"
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
          <h2>创作默认值</h2>
          <p>设置每次新建创作时自动填入的内容。</p>
        </div>

        <div class="settings-fields">
          <label class="settings-prompt-field">
            <span class="settings-field-label">默认提示词</span>
            <span class="settings-field-help">新建创作时会自动填入这段提示词，你仍可在生成前随时修改。</span>
            <textarea v-model="draft.defaultParams.prompt" />
          </label>
        </div>
      </section>
    </form>
  </section>
</template>
