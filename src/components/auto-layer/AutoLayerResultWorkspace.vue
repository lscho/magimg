<script setup lang="ts">
import { shallowRef, watch } from "vue";
import { Layers3, X } from "lucide-vue-next";
import AutoLayerCanvas from "./AutoLayerCanvas.vue";
import AutoLayerInspector from "./AutoLayerInspector.vue";
import type { AutoLayerDocument, AutoLayerItem } from "./types";

const props = defineProps<{ document: AutoLayerDocument }>();
const emit = defineEmits<{ close: []; updateLayers: [layers: AutoLayerItem[]] }>();
const selectedId = shallowRef<string | null>(props.document.layers.at(-1)?.id ?? null);

watch(() => props.document.layers.map(layer => layer.id).join("|"), () => {
  if (!props.document.layers.some(layer => layer.id === selectedId.value)) {
    selectedId.value = props.document.layers.at(-1)?.id ?? null;
  }
});
</script>

<template>
  <section class="auto-layer-result" aria-label="自动分层结果">
    <header class="auto-layer-result-header">
      <div><Layers3 :size="16" aria-hidden="true" /><h2>分层结果</h2></div>
      <span>{{ document.layers.length }} 个图层 · {{ document.status === 'complete' ? '已完成' : '草稿' }}</span>
      <button type="button" title="关闭结果" aria-label="关闭结果" @click="emit('close')"><X :size="16" /></button>
    </header>
    <div class="auto-layer-editor">
      <AutoLayerCanvas
        :background-blob="document.backgroundBlob"
        :image-width="document.width"
        :image-height="document.height"
        :layers="document.layers"
        :selected-id="selectedId"
        @select="selectedId = $event"
        @update-layers="emit('updateLayers', $event)"
      />
      <AutoLayerInspector
        :layers="document.layers"
        :selected-id="selectedId"
        :image-width="document.width"
        :image-height="document.height"
        @select="selectedId = $event"
        @update-layers="emit('updateLayers', $event)"
      />
    </div>
  </section>
</template>

<style scoped lang="scss">
.auto-layer-result { min-width: 0; min-height: 0; display: grid; grid-template-rows: 44px minmax(0, 1fr); overflow: hidden; background: var(--surface); }
.auto-layer-result-header { display: grid; grid-template-columns: minmax(0, 1fr) auto 30px; align-items: center; gap: 8px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--line); }
.auto-layer-result-header > div { min-width: 0; display: flex; align-items: center; gap: 7px; color: var(--accent-strong); }
.auto-layer-result-header h2 { margin: 0; color: var(--text); font-size: 13px; letter-spacing: 0; }
.auto-layer-result-header span { color: var(--muted); font-size: 10px; white-space: nowrap; }
.auto-layer-result-header button { width: 30px; height: 30px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 5px; color: var(--muted); background: transparent; }
.auto-layer-result-header button:hover { color: var(--text); background: var(--surface-subtle); }
.auto-layer-result-header button:focus-visible { outline: 2px solid var(--accent); }
.auto-layer-editor { min-width: 0; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 196px; overflow: hidden; }
@media (max-width: 1100px) { .auto-layer-editor { grid-template-columns: minmax(0, 1fr) 176px; } }
</style>
