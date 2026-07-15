<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { defaultParams } from "@/constants/defaults";
import GeneratorPanel from "@/components/GeneratorPanel.vue";
import ResultGrid from "@/components/ResultGrid.vue";
import PromptTemplateModal from "@/components/PromptTemplateModal.vue";
import { useAppStore } from "@/stores/app";
import type { GenerationMode, GenerationRecord, ImageParams, PromptTemplate } from "@/types";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const params = ref<ImageParams>({ ...defaultParams });
const currentRecord = ref<GenerationRecord | null>(null);
const showTemplates = ref(false);

const mode = computed<GenerationMode>(() =>
  route.params.mode === "image-to-image" ? "image-to-image" : "text-to-image"
);

watch(
  mode,
  (nextMode) => {
    app.activeMode = nextMode;
    const template = app.consumeTemplate(nextMode);
    if (template) {
      params.value = { ...params.value, model: "gpt-image-2", prompt: template.prompt };
    }
  },
  { immediate: true }
);

watch(
  () => route.params.mode,
  (nextMode) => {
    if (nextMode !== "text-to-image" && nextMode !== "image-to-image") {
      void router.replace("/generate/text-to-image");
    }
  },
  { immediate: true }
);

function clearPrompt() {
  params.value = { ...params.value, prompt: "" };
}

async function generate() {
  currentRecord.value = await app.generate(mode.value, params.value);
}

function applyTemplate(template: PromptTemplate) {
  params.value = { ...params.value, model: "gpt-image-2", prompt: template.prompt };
  showTemplates.value = false;
}
</script>

<template>
  <div class="generate-layout">
    <GeneratorPanel
      v-model:params="params"
      :mode="mode"
      :loading="app.generating"
      @clear="clearPrompt"
      @open-templates="showTemplates = true"
      @generate="generate"
    />
    <ResultGrid
      :record="currentRecord || app.visibleHistory[0] || null"
      :loading="app.generating"
      :save-directory="app.settings.saveDirectory"
      @regenerate="generate"
    />
    <PromptTemplateModal v-if="showTemplates" :mode="mode" @close="showTemplates = false" @use="applyTemplate" />
  </div>
</template>
