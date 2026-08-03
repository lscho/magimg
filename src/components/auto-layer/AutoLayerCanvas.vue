<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from "vue";
import { Maximize2 } from "lucide-vue-next";
import { moveAutoLayer, scaleAutoLayer } from "@/services/autoLayerModel";
import { autoLayerFontFamilies, fitAutoLayerTextFontSize } from "@/services/autoLayerRecognition";
import type { AutoLayerItem } from "./types";

const props = defineProps<{
  backgroundBlob: Blob;
  imageWidth: number;
  imageHeight: number;
  layers: AutoLayerItem[];
  selectedId: string | null;
}>();

const emit = defineEmits<{
  select: [id: string];
  updateLayers: [layers: AutoLayerItem[]];
}>();

interface LayerInteraction {
  type: "drag" | "scale";
  pointerId: number;
  layer: AutoLayerItem;
  startX: number;
  startY: number;
}

const viewport = useTemplateRef<HTMLElement>("viewport");
const stage = useTemplateRef<HTMLElement>("stage");
const stageWidth = shallowRef(1);
const stageHeight = shallowRef(1);
const editingId = shallowRef<string | null>(null);
const interaction = shallowRef<LayerInteraction | null>(null);
const backgroundUrl = shallowRef("");
const layerUrls = shallowRef<Record<string, string>>({});
let resizeObserver: ResizeObserver | null = null;
let backgroundBlob: Blob | null = null;
const layerUrlEntries = new Map<string, { blob: Blob; url: string }>();

const previewScale = computed(() => stageWidth.value / Math.max(1, props.imageWidth));
const stageStyle = computed(() => ({
  width: `${stageWidth.value}px`,
  height: `${stageHeight.value}px`
}));

function resizeStage() {
  const element = viewport.value;
  if (!element) return;
  const availableWidth = Math.max(1, element.clientWidth - 32);
  const availableHeight = Math.max(1, element.clientHeight - 32);
  const scale = Math.min(
    availableWidth / Math.max(1, props.imageWidth),
    availableHeight / Math.max(1, props.imageHeight)
  );
  stageWidth.value = Math.max(1, Math.round(props.imageWidth * scale));
  stageHeight.value = Math.max(1, Math.round(props.imageHeight * scale));
}

function layerStyle(layer: AutoLayerItem, index: number) {
  const scale = previewScale.value;
  return {
    left: `${layer.x * scale}px`,
    top: `${layer.y * scale}px`,
    width: `${layer.width * scale}px`,
    height: `${layer.height * scale}px`,
    zIndex: index + 1
  };
}

function textStyle(layer: AutoLayerItem) {
  if (layer.kind !== "text") return {};
  const layerScale = Math.min(
    layer.width / Math.max(1, layer.sourceBox.width),
    layer.height / Math.max(1, layer.sourceBox.height)
  );
  return {
    color: layer.color,
    fontSize: `${Math.max(4, layer.fontSize * layerScale * previewScale.value)}px`,
    fontWeight: layer.fontWeight,
    fontFamily: autoLayerFontFamilies[layer.fontCategory]
  };
}

function replaceLayer(id: string, next: AutoLayerItem) {
  emit("updateLayers", props.layers.map((layer) => layer.id === id ? next : layer));
}

function startInteraction(type: LayerInteraction["type"], layer: AutoLayerItem, event: PointerEvent) {
  if (event.button !== 0 || editingId.value === layer.id) return;
  event.preventDefault();
  emit("select", layer.id);
  interaction.value = {
    type,
    pointerId: event.pointerId,
    layer: { ...layer },
    startX: event.clientX,
    startY: event.clientY
  };
  stage.value?.setPointerCapture(event.pointerId);
}

function handlePointerMove(event: PointerEvent) {
  const current = interaction.value;
  if (!current || current.pointerId !== event.pointerId) return;
  event.preventDefault();
  const scale = Math.max(0.001, previewScale.value);
  const deltaX = (event.clientX - current.startX) / scale;
  const deltaY = (event.clientY - current.startY) / scale;
  if (current.type === "drag") {
    replaceLayer(current.layer.id, moveAutoLayer(
      current.layer,
      current.layer.x + deltaX,
      current.layer.y + deltaY,
      props.imageWidth,
      props.imageHeight
    ));
    return;
  }
  const scaleDelta = Math.abs(deltaX) >= Math.abs(deltaY)
    ? deltaX / Math.max(1, current.layer.sourceBox.width)
    : deltaY / Math.max(1, current.layer.sourceBox.height);
  const initialScale = current.layer.width / Math.max(1, current.layer.sourceBox.width);
  replaceLayer(current.layer.id, scaleAutoLayer(
    current.layer,
    initialScale + scaleDelta,
    props.imageWidth,
    props.imageHeight
  ));
}

function finishInteraction(event: PointerEvent) {
  if (interaction.value?.pointerId !== event.pointerId) return;
  interaction.value = null;
  if (stage.value?.hasPointerCapture(event.pointerId)) {
    stage.value.releasePointerCapture(event.pointerId);
  }
}

function beginTextEditing(layer: AutoLayerItem, event: MouseEvent) {
  if (layer.kind !== "text") return;
  editingId.value = layer.id;
  emit("select", layer.id);
  const target = event.currentTarget as HTMLElement | null;
  void nextTick(() => {
    target?.focus();
    const selection = window.getSelection();
    if (!selection || !target) return;
    selection.selectAllChildren(target);
    selection.collapseToEnd();
  });
}

function finishTextEditing(layer: AutoLayerItem, event: FocusEvent) {
  if (layer.kind !== "text") return;
  const target = event.currentTarget as HTMLElement | null;
  const text = target?.textContent?.replace(/\s+/gu, " ").trim() || "输入文字";
  const fontSize = text === layer.text ? layer.fontSize : fitAutoLayerTextFontSize({
    text,
    width: layer.sourceBox.width,
    height: layer.sourceBox.height,
    fontWeight: layer.fontWeight,
    fontCategory: layer.fontCategory,
    maxFontSize: layer.fontSize
  });
  replaceLayer(layer.id, { ...layer, text, fontSize });
  editingId.value = null;
}

function handleLayerKeydown(layer: AutoLayerItem, event: KeyboardEvent) {
  if (editingId.value === layer.id) return;
  if (event.key === "Enter" && layer.kind === "text") {
    event.preventDefault();
    (event.currentTarget as HTMLElement | null)
      ?.querySelector<HTMLElement>(".auto-layer-text")
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    return;
  }
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  const x = layer.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0);
  const y = layer.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0);
  replaceLayer(layer.id, moveAutoLayer(layer, x, y, props.imageWidth, props.imageHeight));
}

function clearObjectUrls() {
  if (backgroundUrl.value) URL.revokeObjectURL(backgroundUrl.value);
  for (const entry of layerUrlEntries.values()) URL.revokeObjectURL(entry.url);
  backgroundUrl.value = "";
  layerUrls.value = {};
  backgroundBlob = null;
  layerUrlEntries.clear();
}

function syncObjectUrls() {
  if (backgroundBlob !== props.backgroundBlob) {
    if (backgroundUrl.value) URL.revokeObjectURL(backgroundUrl.value);
    backgroundBlob = props.backgroundBlob;
    backgroundUrl.value = URL.createObjectURL(props.backgroundBlob);
  }

  const visibleIds = new Set(props.layers.map((layer) => layer.id));
  for (const [id, entry] of layerUrlEntries) {
    if (visibleIds.has(id)) continue;
    URL.revokeObjectURL(entry.url);
    layerUrlEntries.delete(id);
  }
  for (const layer of props.layers) {
    const current = layerUrlEntries.get(layer.id);
    if (current?.blob === layer.blob) continue;
    if (current) URL.revokeObjectURL(current.url);
    layerUrlEntries.set(layer.id, {
      blob: layer.blob,
      url: URL.createObjectURL(layer.blob)
    });
  }
  layerUrls.value = Object.fromEntries(
    props.layers.map((layer) => [layer.id, layerUrlEntries.get(layer.id)!.url])
  );
}

watch(
  () => [props.backgroundBlob, ...props.layers.map((layer) => layer.blob)],
  syncObjectUrls,
  { immediate: true }
);
watch(() => [props.imageWidth, props.imageHeight], resizeStage);

onMounted(() => {
  resizeObserver = new ResizeObserver(resizeStage);
  if (viewport.value) resizeObserver.observe(viewport.value);
  resizeStage();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  clearObjectUrls();
});
</script>

<template>
  <main ref="viewport" class="auto-layer-canvas" aria-label="分层结果画布">
    <div
      ref="stage"
      class="auto-layer-stage"
      :style="stageStyle"
      @pointermove="handlePointerMove"
      @pointerup="finishInteraction"
      @pointercancel="finishInteraction"
    >
      <img class="auto-layer-background" :src="backgroundUrl" alt="分层背景" draggable="false" />
      <div
        v-for="(layer, index) in layers"
        v-show="layer.visible"
        :key="layer.id"
        class="auto-layer-object"
        :class="{
          'is-selected': selectedId === layer.id,
          'is-text': layer.kind === 'text',
          'is-editing': editingId === layer.id
        }"
        :style="layerStyle(layer, index)"
        :aria-label="`${layer.name}，可拖动和缩放`"
        tabindex="0"
        @focus="emit('select', layer.id)"
        @keydown="handleLayerKeydown(layer, $event)"
        @pointerdown="startInteraction('drag', layer, $event)"
      >
        <img
          v-if="layer.kind === 'material'"
          class="auto-layer-material"
          :src="layerUrls[layer.id]"
          :alt="layer.name"
          draggable="false"
        />
        <span
          v-else
          class="auto-layer-text"
          :contenteditable="editingId === layer.id ? 'plaintext-only' : 'false'"
          :style="textStyle(layer)"
          role="textbox"
          :aria-label="`编辑${layer.name}`"
          @dblclick.stop="beginTextEditing(layer, $event)"
          @blur="finishTextEditing(layer, $event)"
        >{{ layer.text }}</span>
        <button
          v-if="selectedId === layer.id && editingId !== layer.id"
          class="auto-layer-scale-handle"
          type="button"
          title="拖动缩放图层"
          aria-label="拖动缩放图层"
          @pointerdown.stop="startInteraction('scale', layer, $event)"
        >
          <Maximize2 :size="11" aria-hidden="true" />
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped lang="scss">
.auto-layer-canvas {
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background-color: var(--field);
  background-image:
    linear-gradient(45deg, var(--surface-subtle) 25%, transparent 25%),
    linear-gradient(-45deg, var(--surface-subtle) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--surface-subtle) 75%),
    linear-gradient(-45deg, transparent 75%, var(--surface-subtle) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}

.auto-layer-stage {
  position: relative;
  flex: 0 0 auto;
  overflow: hidden;
  box-shadow: 0 0 0 1px var(--line-strong), 0 12px 28px rgba(0, 0, 0, 0.24);
  touch-action: none;
}

.auto-layer-background,
.auto-layer-material {
  width: 100%;
  height: 100%;
  display: block;
  user-select: none;
}

.auto-layer-background {
  position: absolute;
  inset: 0;
}

.auto-layer-object {
  position: absolute;
  min-width: 8px;
  min-height: 8px;
  border: 1px solid transparent;
  outline: none;
  cursor: move;
  user-select: none;

  &.is-selected,
  &:focus-visible {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px rgba(88, 166, 255, 0.24);
  }

  &.is-editing {
    cursor: text;
    user-select: text;
  }
}

.auto-layer-text {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  line-height: 1;
  text-align: center;
  white-space: nowrap;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.42);
  letter-spacing: 0;
  outline: none;
}

.auto-layer-scale-handle {
  position: absolute;
  right: -10px;
  bottom: -10px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid var(--accent-border);
  border-radius: 4px;
  color: var(--text);
  background: var(--surface-raised);
  cursor: nwse-resize;

  &:focus-visible { outline: 2px solid var(--accent); }
}

@media (prefers-reduced-motion: reduce) {
  .auto-layer-object { transition: none; }
}
</style>
