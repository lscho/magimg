<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { defaultParams } from "@/constants/defaults";
import GeneratorPanel from "@/components/GeneratorPanel.vue";
import ResultGrid from "@/components/ResultGrid.vue";
import PromptTemplateModal from "@/components/PromptTemplateModal.vue";
import { isMockApi } from "@/services/apiClient";
import { useAppStore } from "@/stores/app";
import type {
  GenerationMode,
  GenerationRecord,
  ImageParams,
  PromptTemplate,
  SelectedImageFile
} from "@/types";

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const params = ref<ImageParams>({ ...defaultParams });
const currentRecord = shallowRef<GenerationRecord | null>(null);
const referenceImage = shallowRef<SelectedImageFile | null>(null);
const showTemplates = shallowRef(false);

const mode = computed<GenerationMode>(() =>
  route.params.mode === "image-to-image" ? "image-to-image" : "text-to-image"
);
const visibleRecord = computed(
  () =>
    (currentRecord.value?.mode === mode.value ? currentRecord.value : null) ??
    app.visibleHistory.find((record) => record.mode === mode.value) ??
    null
);
const hasResult = computed(
  () => visibleRecord.value?.status === "succeeded" && visibleRecord.value.images.length > 0
);
const generationCost = computed(() =>
  mode.value === "image-to-image"
    ? app.capabilities.imageToImageCost
    : app.capabilities.textToImageCost
);
const insufficientCredits = computed(
  () =>
    app.isAuthenticated &&
    (app.balance.balance < generationCost.value || app.generationErrorKind === "insufficientCredits")
);

watch(
  mode,
  (nextMode) => {
    app.activeMode = nextMode;
    const template = app.consumeTemplate(nextMode);
    if (template) {
      applyTemplateParams(template);
    } else {
      params.value = { ...params.value, templateId: undefined };
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

watch(
  params,
  () => {
    app.clearGenerationError();
  },
  { deep: true }
);

function clearPrompt() {
  params.value = { ...params.value, prompt: "" };
}

async function generate() {
  try {
    currentRecord.value = await app.generate(mode.value, params.value, referenceImage.value);
  } catch {
    // The store exposes the user-facing error in the generator panel.
  }
}

async function cancelGeneration() {
  try {
    await app.cancelCurrentGeneration();
  } catch {
    // A task may begin processing between rendering the button and cancellation.
  }
}

function applyTemplateParams(template: PromptTemplate) {
  params.value = {
    ...params.value,
    model: "gpt-image-2",
    prompt: template.prompt,
    templateId: template.templateId,
    ...(template.width && template.height ? { size: `${template.width}x${template.height}` as const } : {}),
    ...(template.quality ? { quality: template.quality } : {})
  };
}

function applyTemplate(template: PromptTemplate) {
  applyTemplateParams(template);
  showTemplates.value = false;
}
</script>

<template>
  <div class="generate-layout">
    <ResultGrid
      :record="visibleRecord"
      :loading="app.generating"
      :save-directory="app.settings.saveDirectory"
      :can-cancel="app.currentTaskStatus === 'pending'"
      @cancel="cancelGeneration"
    />
    <GeneratorPanel
      v-model:params="params"
      :mode="mode"
      :loading="app.generating"
      :cost="generationCost"
      :balance="app.balance.balance"
      :has-result="hasResult"
      :insufficient-credits="insufficientCredits"
      :error="app.error"
      :show-output-options="isMockApi"
      :max-prompt-length="4000"
      :supported-qualities="app.capabilities.supportedQualities"
      :upload-max-bytes="app.capabilities.uploadMaxBytes"
      :size-rules="app.capabilities.sizeRules"
      @clear="clearPrompt"
      @open-templates="showTemplates = true"
      @reference-selected="referenceImage = $event"
      @generate="generate"
    />
    <PromptTemplateModal v-if="showTemplates" :mode="mode" @close="showTemplates = false" @use="applyTemplate" />
  </div>
</template>

<style scoped lang="scss">
.generate-layout {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(340px, 23vw, 372px);
  gap: 0;
  overflow: hidden;
}

@media (max-width: 1180px) {
  .generate-layout {
    grid-template-columns: minmax(0, 1fr) 340px;
  }
}

@media (max-width: 900px) {
  .generate-layout {
    grid-template-columns: 1fr;
    overflow: visible;
  }
}
</style>
