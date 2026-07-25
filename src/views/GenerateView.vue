<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { defaultParams } from "@/constants/defaults";
import GeneratorPanel from "@/components/GeneratorPanel.vue";
import LoginModal from "@/components/LoginModal.vue";
import ResultGrid from "@/components/ResultGrid.vue";
import PromptTemplateModal from "@/components/PromptTemplateModal.vue";
import {
  stageImageEditorHandoff,
  type ImageEditorHandoff
} from "@/services/imageEditorHandoff";
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
const referenceImage = shallowRef<SelectedImageFile | null>(null);
const showTemplates = shallowRef(false);
const showLogin = shallowRef(false);
const taskAttached = shallowRef(false);
const openedHistoryRecord = ref<GenerationRecord | null>(null);

const mode = computed<GenerationMode>(() =>
  route.params.mode === "image-to-image" ? "image-to-image" : "text-to-image"
);
const attachedRecord = computed(() => {
  if (openedHistoryRecord.value) {
    return app.activeGeneration?.generationId === openedHistoryRecord.value.generationId
      ? app.activeGeneration
      : openedHistoryRecord.value;
  }
  return app.activeGeneration?.mode === mode.value ? app.activeGeneration : null;
});
const visibleRecord = computed(() => (taskAttached.value ? attachedRecord.value : null));
const recoverableTask = computed(() => {
  const recoverable = app.recoverableGeneration;
  return recoverable?.generationId === visibleRecord.value?.generationId ? null : recoverable;
});
const previewLoading = computed(
  () =>
    taskAttached.value &&
    ((!openedHistoryRecord.value && app.creatingGeneration) ||
      visibleRecord.value?.status === "queued" ||
      visibleRecord.value?.status === "processing")
);
const isViewingActiveGeneration = computed(
  () =>
    Boolean(visibleRecord.value) &&
    visibleRecord.value?.generationId === app.activeGeneration?.generationId
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
  () => ({ mode: mode.value, initialized: app.initialized }),
  (next, previous) => {
    if (!next.initialized) return;
    if (previous?.initialized && previous.mode === next.mode) return;
    resetWorkspace(next.mode);
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

watch(referenceImage, (image) => {
  const nextPath = image?.path;
  if (params.value.referenceImagePath !== nextPath) {
    params.value = { ...params.value, referenceImagePath: nextPath };
  }
});

function clearPrompt() {
  params.value = { ...params.value, prompt: "" };
}

async function generate() {
  if (!app.isAuthenticated) {
    showLogin.value = true;
    return;
  }
  openedHistoryRecord.value = null;
  taskAttached.value = true;
  try {
    await app.generate(mode.value, params.value, referenceImage.value);
  } catch {
    // The store exposes the user-facing error in the generator panel.
  }
}

function onLoginSuccess() {
  showLogin.value = false;
  void generate();
}

function workspaceParams() {
  const configured = app.initialized ? app.settings.defaultParams : defaultParams;
  return {
    ...configured,
    model: "gpt-image-2" as const,
    n: 1,
    background: "auto" as const,
    referenceImagePath: undefined,
    templateId: undefined
  };
}

function resetWorkspace(nextMode: GenerationMode) {
  app.activeMode = nextMode;
  params.value = workspaceParams();
  referenceImage.value = null;
  taskAttached.value = false;
  openedHistoryRecord.value = null;
  showTemplates.value = false;
  app.clearGenerationError();

  const historyWorkspace = app.consumeHistoryWorkspace(nextMode);
  if (historyWorkspace) {
    params.value = { ...historyWorkspace.record.params };
    referenceImage.value = historyWorkspace.referenceImage;
    openedHistoryRecord.value = historyWorkspace.record;
    taskAttached.value = true;
    return;
  }

  const pendingReferenceImage = app.consumeReferenceImage(nextMode);
  if (pendingReferenceImage) {
    referenceImage.value = pendingReferenceImage;
    params.value = {
      ...params.value,
      referenceImagePath: pendingReferenceImage.path
    };
  }

  const template = app.consumeTemplate(nextMode);
  if (template) applyTemplateParams(template);
}

async function restoreTask() {
  const task = app.recoverableGeneration;
  if (!task) return;
  if (mode.value !== task.mode) await router.push(`/generate/${task.mode}`);
  params.value = {
    ...task.params,
    referenceImagePath: undefined
  };
  referenceImage.value = null;
  openedHistoryRecord.value = null;
  taskAttached.value = true;
  app.clearGenerationError();
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

async function useAsReference(image: SelectedImageFile) {
  if (mode.value !== "image-to-image") {
    await router.push("/generate/image-to-image");
    await nextTick();
  }
  referenceImage.value = image;
  openedHistoryRecord.value = null;
  params.value = {
    ...params.value,
    referenceImagePath: image.path
  };
  taskAttached.value = false;
  app.clearGenerationError();
}

async function editImage(handoff: ImageEditorHandoff) {
  stageImageEditorHandoff(handoff);
  await router.push("/editor");
}
</script>

<template>
  <div class="generate-layout">
    <ResultGrid
      :record="visibleRecord"
      :loading="previewLoading"
      :save-directory="app.settings.saveDirectory"
      :can-cancel="
        isViewingActiveGeneration &&
        app.generating &&
        app.currentTaskStatus !== 'processing'
      "
      :recoverable-task="recoverableTask"
      :mode="mode"
      @cancel="cancelGeneration"
      @edit-image="editImage"
      @restore-task="restoreTask"
      @use-as-reference="useAsReference"
    />
    <GeneratorPanel
      v-model:params="params"
      :mode="mode"
      :loading="app.generating"
      :cost="generationCost"
      :balance="app.balance.balance"
      :has-result="hasResult"
      :insufficient-credits="insufficientCredits"
      :is-logged-in="app.isAuthenticated"
      :error="taskAttached && isViewingActiveGeneration ? app.error : ''"
      :max-prompt-length="4000"
      :supported-qualities="app.capabilities.supportedQualities"
      :upload-max-bytes="app.capabilities.uploadMaxBytes"
      :size-rules="app.capabilities.sizeRules"
      @clear="clearPrompt"
      @open-templates="showTemplates = true"
      v-model:reference-image="referenceImage"
      @generate="generate"
    />
    <PromptTemplateModal v-if="showTemplates" :mode="mode" @close="showTemplates = false" @use="applyTemplate" />
    <LoginModal v-if="showLogin" context="generation" @close="showLogin = false" @success="onLoginSuccess" />
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
