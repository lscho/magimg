<script setup lang="ts">
import { computed } from "vue";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Image as ImageIcon,
  RotateCcw,
  Type
} from "lucide-vue-next";
import { materialToText, resetAutoLayers, scaleAutoLayer, textToMaterial } from "@/services/autoLayerModel";
import { fitAutoLayerTextFontSize } from "@/services/autoLayerRecognition";
import type { AutoLayerFontCategory, AutoLayerItem } from "./types";

const props = defineProps<{
  layers: AutoLayerItem[];
  selectedId: string | null;
  imageWidth: number;
  imageHeight: number;
}>();

const emit = defineEmits<{
  select: [id: string];
  updateLayers: [layers: AutoLayerItem[]];
}>();

const selectedLayer = computed(() =>
  props.layers.find((layer) => layer.id === props.selectedId) ?? null
);
const visibleLayers = computed(() => [...props.layers].reverse());
const selectedScale = computed(() => {
  const layer = selectedLayer.value;
  if (!layer) return 100;
  return Math.round(layer.width / Math.max(1, layer.sourceBox.width) * 100);
});

function replaceLayer(id: string, patch: Record<string, unknown>) {
  emit("updateLayers", props.layers.map((layer) =>
    layer.id === id ? { ...layer, ...patch } as AutoLayerItem : layer
  ));
}

function setKind(kind: AutoLayerItem["kind"]) {
  const layer = selectedLayer.value;
  if (!layer) return;
  emit("updateLayers", props.layers.map((item) =>
    item.id === layer.id
      ? kind === item.kind ? item : item.kind === "material" ? materialToText(item) : textToMaterial(item)
      : item
  ));
}

function setScale(event: Event) {
  const layer = selectedLayer.value;
  const target = event.target as HTMLInputElement | null;
  if (!layer || !target) return;
  const scale = Number(target.value) / 100;
  emit("updateLayers", props.layers.map((item) =>
    item.id === layer.id
      ? scaleAutoLayer(item, scale, props.imageWidth, props.imageHeight)
      : item
  ));
}

function setText(value: string) {
  const layer = selectedLayer.value;
  if (!layer || layer.kind !== "text") return;
  const text = value.replace(/\s+/gu, " ");
  replaceLayer(layer.id, {
    text,
    fontSize: fitAutoLayerTextFontSize({
      text,
      width: layer.sourceBox.width,
      height: layer.sourceBox.height,
      fontWeight: layer.fontWeight,
      fontCategory: layer.fontCategory,
      maxFontSize: layer.fontSize
    })
  });
}

function resetAllTransforms() {
  emit("updateLayers", resetAutoLayers(props.layers));
}

function moveLayer(id: string, direction: 1 | -1) {
  const index = props.layers.findIndex((layer) => layer.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= props.layers.length) return;
  const next = [...props.layers];
  [next[index], next[target]] = [next[target], next[index]];
  emit("updateLayers", next);
}
</script>

<template>
  <aside class="auto-layer-inspector" aria-label="图层属性">
    <section class="auto-layer-list-section" aria-labelledby="auto-layer-list-heading">
      <div class="auto-layer-section-heading">
        <h3 id="auto-layer-list-heading">图层</h3>
        <span>{{ layers.length }}</span>
      </div>
      <ul class="auto-layer-list">
        <li v-for="layer in visibleLayers" :key="layer.id">
          <button
            class="auto-layer-list-item"
            type="button"
            :class="{ 'is-active': selectedId === layer.id }"
            :aria-pressed="selectedId === layer.id"
            @click="emit('select', layer.id)"
          >
            <Type v-if="layer.kind === 'text'" :size="13" aria-hidden="true" />
            <ImageIcon v-else :size="13" aria-hidden="true" />
            <span>{{ layer.name }}</span>
          </button>
          <button
            class="auto-layer-icon-button"
            type="button"
            :title="layer.visible ? '隐藏图层' : '显示图层'"
            :aria-label="layer.visible ? `隐藏${layer.name}` : `显示${layer.name}`"
            @click="replaceLayer(layer.id, { visible: !layer.visible })"
          >
            <Eye v-if="layer.visible" :size="13" aria-hidden="true" />
            <EyeOff v-else :size="13" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </section>

    <section v-if="selectedLayer" class="auto-layer-properties" aria-labelledby="auto-layer-properties-heading">
      <div class="auto-layer-section-heading">
        <h3 id="auto-layer-properties-heading">属性</h3>
        <div class="auto-layer-order-actions">
          <button
            type="button"
            title="上移一层"
            aria-label="上移一层"
            :disabled="layers.at(-1)?.id === selectedLayer.id"
            @click="moveLayer(selectedLayer.id, 1)"
          >
            <ChevronUp :size="13" aria-hidden="true" />
          </button>
          <button
            type="button"
            title="下移一层"
            aria-label="下移一层"
            :disabled="layers[0]?.id === selectedLayer.id"
            @click="moveLayer(selectedLayer.id, -1)"
          >
            <ChevronDown :size="13" aria-hidden="true" />
          </button>
        </div>
      </div>

      <label class="auto-layer-field">
        <span>名称</span>
        <input
          type="text"
          :value="selectedLayer.name"
          maxlength="40"
          @input="replaceLayer(selectedLayer.id, { name: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <div class="auto-layer-field">
        <span>类型</span>
        <div class="auto-layer-kind-control">
          <button
            type="button"
            :aria-pressed="selectedLayer.kind === 'material'"
            @click="setKind('material')"
          >
            <ImageIcon :size="13" aria-hidden="true" />
            素材
          </button>
          <button
            type="button"
            :aria-pressed="selectedLayer.kind === 'text'"
            @click="setKind('text')"
          >
            <Type :size="13" aria-hidden="true" />
            文字
          </button>
        </div>
      </div>

      <label v-if="selectedLayer.kind === 'text'" class="auto-layer-field">
        <span>文字内容</span>
        <input
          type="text"
          :value="selectedLayer.text"
          maxlength="300"
          @input="setText(($event.target as HTMLInputElement).value)"
        />
      </label>

      <div v-if="selectedLayer.kind === 'text'" class="auto-layer-text-controls">
        <label class="auto-layer-field">
          <span>字号</span>
          <input
            type="number"
            min="4"
            max="512"
            step="0.1"
            :value="selectedLayer.fontSize"
            @change="replaceLayer(selectedLayer.id, {
              fontSize: Math.min(512, Math.max(4, Number(($event.target as HTMLInputElement).value) || 4))
            })"
          />
        </label>
        <label class="auto-layer-color-field">
          <span>颜色</span>
          <input
            type="color"
            :value="selectedLayer.color"
            @input="replaceLayer(selectedLayer.id, { color: ($event.target as HTMLInputElement).value })"
          />
        </label>
      </div>

      <template v-if="selectedLayer.kind === 'text'">
        <label class="auto-layer-field">
          <span>字重</span>
          <input
            type="number"
            min="100"
            max="900"
            step="100"
            :value="selectedLayer.fontWeight"
            @change="replaceLayer(selectedLayer.id, {
              fontWeight: Math.min(900, Math.max(100, Number(($event.target as HTMLInputElement).value) || 400))
            })"
          />
        </label>
        <label class="auto-layer-field">
          <span>字体类别</span>
          <select
            :value="selectedLayer.fontCategory"
            @change="replaceLayer(selectedLayer.id, {
              fontCategory: ($event.target as HTMLSelectElement).value as AutoLayerFontCategory
            })"
          >
            <option value="sans">Sans</option>
            <option value="serif">Serif</option>
            <option value="rounded">Rounded</option>
            <option value="display">Display</option>
            <option value="calligraphic">Calligraphic</option>
          </select>
        </label>
      </template>

      <label class="auto-layer-range-field">
        <span>缩放 <strong>{{ selectedScale }}%</strong></span>
        <input type="range" min="20" max="400" step="1" :value="selectedScale" @input="setScale" />
      </label>

      <button class="auto-layer-reset-button" type="button" @click="resetAllTransforms">
        <RotateCcw :size="13" aria-hidden="true" />
        还原全部位置与大小
      </button>
    </section>
  </aside>
</template>

<style scoped lang="scss">
.auto-layer-inspector {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  border-left: 1px solid var(--line);
  background: var(--surface);
}

.auto-layer-list-section,
.auto-layer-properties {
  padding: 12px;
}

.auto-layer-properties { border-top: 1px solid var(--line); }

.auto-layer-section-heading {
  min-height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;

  h3,
  span {
    margin: 0;
    color: var(--muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0;
  }
}

.auto-layer-list {
  max-height: 188px;
  margin: 0;
  padding: 0;
  overflow: auto;
  list-style: none;

  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28px;
    gap: 4px;
    margin-bottom: 4px;
  }
}

.auto-layer-list-item,
.auto-layer-icon-button,
.auto-layer-order-actions button {
  height: 28px;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--muted);
  background: transparent;

  &:hover { color: var(--text); background: var(--surface-subtle); }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
}

.auto-layer-list-item {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 8px;
  text-align: left;

  span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  &.is-active { color: var(--accent-strong); border-color: var(--accent-border); background: var(--accent-soft); }
}

.auto-layer-icon-button { width: 28px; display: grid; place-items: center; padding: 0; }

.auto-layer-order-actions { display: flex; gap: 3px; }
.auto-layer-order-actions button { width: 26px; padding: 0; display: grid; place-items: center; }
.auto-layer-order-actions button:disabled { opacity: 0.36; cursor: not-allowed; }

.auto-layer-field,
.auto-layer-range-field,
.auto-layer-color-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;

  > span {
    color: var(--muted);
    font-size: 10px;
    font-weight: 650;
  }

  input[type="text"],
  input[type="number"],
  textarea {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--text);
    background: var(--field);
    font-size: 11px;

    &:focus { border-color: var(--accent-border); outline: 2px solid var(--accent-soft); }
  }

  input[type="text"],
  input[type="number"] { height: 34px; padding: 0 9px; }
}

.auto-layer-kind-control {
  display: grid;
  grid-template-columns: 1fr 1fr;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 6px;

  button {
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    border: 0;
    border-right: 1px solid var(--line);
    border-radius: 0;
    color: var(--muted);
    background: var(--field);
    font-size: 10px;

    &:last-child { border-right: 0; }
    &[aria-pressed="true"] { color: var(--accent-strong); background: var(--accent-soft); }
    &:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  }
}

.auto-layer-text-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 54px;
  gap: 8px;
}

.auto-layer-color-field input {
  width: 100%;
  height: 34px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--field);
}

.auto-layer-range-field {
  span { display: flex; justify-content: space-between; }
  strong { color: var(--text); font-weight: 650; }
  input { width: 100%; accent-color: var(--accent); }
}

.auto-layer-reset-button {
  width: 100%;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--muted);
  background: transparent;
  font-size: 10px;

  &:hover { color: var(--text); border-color: var(--line-strong); background: var(--surface-subtle); }
  &:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
}
</style>
