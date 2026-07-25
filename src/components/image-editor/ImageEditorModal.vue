<script setup lang="ts">
import { useTemplateRef } from "vue";
import ImageEditorWorkspace from "./ImageEditorWorkspace.vue";
import type {
  ImageEditorApplyResult,
  ImageEditorSource
} from "./types";

defineProps<{
  source: ImageEditorSource;
}>();

const emit = defineEmits<{
  apply: [result: ImageEditorApplyResult];
  close: [];
}>();

const workspace = useTemplateRef<InstanceType<typeof ImageEditorWorkspace>>("workspace");

function requestClose() {
  workspace.value?.requestClose();
}
</script>

<template>
  <Teleport to="body">
    <Transition name="image-editor" appear>
      <div class="image-editor-backdrop" @click.self="requestClose">
        <ImageEditorWorkspace
          ref="workspace"
          :source="source"
          presentation="dialog"
          @apply="emit('apply', $event)"
          @close="emit('close')"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped lang="scss">
.image-editor-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(4, 7, 11, 0.86);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

.image-editor-enter-active,
.image-editor-leave-active {
  transition: opacity 200ms ease;

  :deep(.image-editor-shell) {
    transition: transform 200ms ease, opacity 200ms ease;
  }
}

.image-editor-enter-from,
.image-editor-leave-to {
  opacity: 0;

  :deep(.image-editor-shell) {
    opacity: 0;
    transform: translateY(10px) scale(0.99);
  }
}

@media (max-width: 900px) {
  .image-editor-backdrop {
    padding: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .image-editor-enter-active,
  .image-editor-leave-active,
  .image-editor-enter-active :deep(.image-editor-shell),
  .image-editor-leave-active :deep(.image-editor-shell) {
    transition: none;
  }
}
</style>
