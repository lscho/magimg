<script setup lang="ts">
import { shallowRef, watch } from "vue";
import { Bold, Check, Minus, Plus, Scan, X } from "lucide-vue-next";
import type {
  CropDimension,
  CropRatio,
  ImageAdjustment,
  ImageAdjustments,
  ImageEditorTool
} from "./types";

const props = defineProps<{
  activeTool: ImageEditorTool;
  adjustments: Readonly<ImageAdjustments>;
  brushColor: string;
  brushSize: number;
  busy: boolean;
  cropHeight: number;
  cropRatio: CropRatio;
  cropWidth: number;
  outputHeight: number;
  outputLabel: string;
  outputWidth: number;
  selectedIsText: boolean;
  textBold: boolean;
  textColor: string;
  textSize: number;
  zoomPercent: number;
}>();

const emit = defineEmits<{
  addText: [];
  applyCrop: [];
  cancelCrop: [];
  setAdjustment: [adjustment: ImageAdjustment, value: number, commit: boolean];
  setBrushColor: [color: string];
  setBrushSize: [size: number];
  setCropDimension: [dimension: CropDimension, value: number];
  setCropRatio: [ratio: CropRatio];
  setTextColor: [color: string, commit: boolean];
  setTextSize: [size: number, commit: boolean];
  setZoom: [percent: number];
  toggleTextBold: [];
  fitPreview: [];
  zoomIn: [];
  zoomOut: [];
}>();

const cropRatios: Array<{ value: CropRatio; label: string }> = [
  { value: "free", label: "自由" },
  { value: "original", label: "原始" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" }
];

const adjustmentControls: Array<{
  id: ImageAdjustment;
  label: string;
  min: number;
  max: number;
}> = [
  { id: "brightness", label: "亮度", min: -100, max: 100 },
  { id: "contrast", label: "对比度", min: -100, max: 100 },
  { id: "saturation", label: "饱和度", min: -100, max: 100 },
  { id: "grayscale", label: "灰度", min: 0, max: 100 }
];

const colorSwatches = [
  "#F1F4F8",
  "#121820",
  "#7898F5",
  "#65CFE0",
  "#65D3AD",
  "#E4A06B",
  "#EF7D88"
];
const cropWidthDraft = shallowRef("");
const cropHeightDraft = shallowRef("");

watch(
  () => props.cropWidth,
  (value) => {
    cropWidthDraft.value = String(value);
  },
  { immediate: true }
);

watch(
  () => props.cropHeight,
  (value) => {
    cropHeightDraft.value = String(value);
  },
  { immediate: true }
);

function numberFromEvent(event: Event) {
  return Number((event.currentTarget as HTMLInputElement).value);
}

function colorFromEvent(event: Event) {
  return (event.currentTarget as HTMLInputElement).value;
}

function cropDimensionDraft(dimension: CropDimension) {
  return dimension === "width" ? cropWidthDraft : cropHeightDraft;
}

function cropDimensionMaximum(dimension: CropDimension) {
  return dimension === "width" ? props.outputWidth : props.outputHeight;
}

function cropDimensionValue(dimension: CropDimension) {
  return dimension === "width" ? props.cropWidth : props.cropHeight;
}

function cropDimensionIsInvalid(dimension: CropDimension) {
  const rawValue = cropDimensionDraft(dimension).value;
  const value = Number(rawValue);
  return rawValue.trim() === "" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > cropDimensionMaximum(dimension);
}

function updateCropDimension(dimension: CropDimension, event: Event) {
  const rawValue = (event.currentTarget as HTMLInputElement).value;
  cropDimensionDraft(dimension).value = rawValue;
  const value = Number(rawValue);
  if (
    rawValue.trim() === "" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > cropDimensionMaximum(dimension)
  ) return;
  emit("setCropDimension", dimension, value);
}

function normalizeCropDimension(dimension: CropDimension) {
  cropDimensionDraft(dimension).value = String(cropDimensionValue(dimension));
}
</script>

<template>
  <aside class="editor-inspector" aria-label="工具设置">
    <header class="inspector-header">
      <span>图片尺寸</span>
      <strong>{{ outputLabel }}</strong>
    </header>

    <section v-if="activeTool === 'crop'" class="inspector-section">
      <h3>裁剪尺寸</h3>
      <div class="crop-size-fields">
        <label>
          <span>宽度</span>
          <span class="crop-size-input" :class="{ invalid: cropDimensionIsInvalid('width') }">
            <input
              :value="cropWidthDraft"
              type="number"
              inputmode="numeric"
              aria-label="裁剪宽度"
              :aria-invalid="cropDimensionIsInvalid('width')"
              min="1"
              :max="outputWidth"
              step="1"
              :disabled="busy"
              @input="updateCropDimension('width', $event)"
              @blur="normalizeCropDimension('width')"
              @keydown.enter.prevent="normalizeCropDimension('width')"
            />
            <em>px</em>
          </span>
        </label>
        <label>
          <span>高度</span>
          <span class="crop-size-input" :class="{ invalid: cropDimensionIsInvalid('height') }">
            <input
              :value="cropHeightDraft"
              type="number"
              inputmode="numeric"
              aria-label="裁剪高度"
              :aria-invalid="cropDimensionIsInvalid('height')"
              min="1"
              :max="outputHeight"
              step="1"
              :disabled="busy"
              @input="updateCropDimension('height', $event)"
              @blur="normalizeCropDimension('height')"
              @keydown.enter.prevent="normalizeCropDimension('height')"
            />
            <em>px</em>
          </span>
        </label>
      </div>
      <h3>裁剪比例</h3>
      <div class="ratio-grid" role="group" aria-label="裁剪比例">
        <button
          v-for="ratio in cropRatios"
          :key="ratio.value"
          type="button"
          :class="{ active: cropRatio === ratio.value }"
          :aria-pressed="cropRatio === ratio.value"
          :disabled="busy"
          @click="emit('setCropRatio', ratio.value)"
        >
          {{ ratio.label }}
        </button>
      </div>
      <div class="inspector-actions">
        <button class="ghost-button" type="button" :disabled="busy" @click="emit('cancelCrop')">
          <X :size="15" aria-hidden="true" /> 取消
        </button>
        <button class="primary-small" type="button" :disabled="busy" @click="emit('applyCrop')">
          <Check :size="15" aria-hidden="true" /> 完成裁剪
        </button>
      </div>
    </section>

    <section v-else-if="activeTool === 'adjust'" class="inspector-section">
      <h3>图片调整</h3>
      <label v-for="control in adjustmentControls" :key="control.id" class="range-control">
        <span>
          <strong>{{ control.label }}</strong>
          <output>{{ adjustments[control.id] }}</output>
        </span>
        <input
          :value="adjustments[control.id]"
          type="range"
          :aria-label="control.label"
          :aria-valuetext="String(adjustments[control.id])"
          :min="control.min"
          :max="control.max"
          step="1"
          :disabled="busy"
          @input="emit('setAdjustment', control.id, numberFromEvent($event), false)"
          @change="emit('setAdjustment', control.id, numberFromEvent($event), true)"
        />
      </label>
    </section>

    <section v-else-if="activeTool === 'text'" class="inspector-section">
      <div class="section-heading-row">
        <h3>文字</h3>
        <button class="add-text-button" type="button" :disabled="busy" @click="emit('addText')">
          <Plus :size="15" aria-hidden="true" /> 新增文字
        </button>
      </div>
      <div class="color-control">
        <span class="control-label">颜色</span>
        <div class="color-swatches" role="group" aria-label="文字颜色">
          <button
            v-for="color in colorSwatches"
            :key="color"
            class="color-swatch"
            :class="{ active: textColor.toLowerCase() === color.toLowerCase() }"
            type="button"
            :style="{ backgroundColor: color }"
            :aria-label="`文字颜色 ${color}`"
            :aria-pressed="textColor.toLowerCase() === color.toLowerCase()"
            :disabled="busy"
            @click="emit('setTextColor', color, true)"
          />
          <label class="custom-color" title="自定义文字颜色">
            <input
              :value="textColor"
              type="color"
              aria-label="自定义文字颜色"
              :disabled="busy"
              @input="emit('setTextColor', colorFromEvent($event), false)"
              @change="emit('setTextColor', colorFromEvent($event), true)"
            />
          </label>
        </div>
      </div>
      <label class="range-control">
        <span>
          <strong>字号</strong>
          <output>{{ textSize }}</output>
        </span>
        <input
          :value="textSize"
          type="range"
          aria-label="字号"
          :aria-valuetext="String(textSize)"
          min="12"
          max="180"
          step="1"
          :disabled="busy || !selectedIsText"
          @input="emit('setTextSize', numberFromEvent($event), false)"
          @change="emit('setTextSize', numberFromEvent($event), true)"
        />
      </label>
      <button
        class="format-toggle"
        type="button"
        :class="{ active: textBold }"
        :aria-pressed="textBold"
        :disabled="busy || !selectedIsText"
        @click="emit('toggleTextBold')"
      >
        <Bold :size="16" aria-hidden="true" /> 粗体
      </button>
    </section>

    <section v-else-if="activeTool === 'draw' || activeTool === 'erase'" class="inspector-section">
      <h3>{{ activeTool === "draw" ? "画笔" : "橡皮擦" }}</h3>
      <div v-if="activeTool === 'draw'" class="color-control">
        <span class="control-label">颜色</span>
        <div class="color-swatches" role="group" aria-label="画笔颜色">
          <button
            v-for="color in colorSwatches"
            :key="color"
            class="color-swatch"
            :class="{ active: brushColor.toLowerCase() === color.toLowerCase() }"
            type="button"
            :style="{ backgroundColor: color }"
            :aria-label="`画笔颜色 ${color}`"
            :aria-pressed="brushColor.toLowerCase() === color.toLowerCase()"
            :disabled="busy"
            @click="emit('setBrushColor', color)"
          />
          <label class="custom-color" title="自定义画笔颜色">
            <input
              :value="brushColor"
              type="color"
              aria-label="自定义画笔颜色"
              :disabled="busy"
              @input="emit('setBrushColor', colorFromEvent($event))"
            />
          </label>
        </div>
      </div>
      <label class="range-control">
        <span>
          <strong>粗细</strong>
          <output>{{ brushSize }}</output>
        </span>
        <input
          :value="brushSize"
          type="range"
          aria-label="粗细"
          :aria-valuetext="String(brushSize)"
          min="2"
          max="48"
          step="1"
          :disabled="busy"
          @input="emit('setBrushSize', numberFromEvent($event))"
        />
      </label>
      <span class="brush-preview" :style="{ '--brush-size': `${Math.min(brushSize, 28)}px` }">
        <i :style="{ backgroundColor: activeTool === 'erase' ? 'var(--soft)' : brushColor }" />
      </span>
    </section>

    <section v-else-if="activeTool === 'pan'" class="inspector-section">
      <h3>画布视图</h3>
      <label class="range-control">
        <span>
          <strong>缩放</strong>
          <output>{{ zoomPercent }}%</output>
        </span>
        <input
          :value="zoomPercent"
          type="range"
          aria-label="画布缩放"
          :aria-valuetext="`${zoomPercent}%`"
          min="25"
          max="400"
          step="5"
          :disabled="busy"
          @input="emit('setZoom', numberFromEvent($event))"
        />
      </label>
      <div class="zoom-button-group" role="group" aria-label="画布缩放操作">
        <button
          type="button"
          title="缩小画布"
          aria-label="缩小画布"
          :disabled="busy || zoomPercent <= 25"
          @click="emit('zoomOut')"
        >
          <Minus :size="15" aria-hidden="true" />
        </button>
        <button type="button" :disabled="busy" @click="emit('fitPreview')">
          <Scan :size="15" aria-hidden="true" />
          适应画布
        </button>
        <button
          type="button"
          title="放大画布"
          aria-label="放大画布"
          :disabled="busy || zoomPercent >= 400"
          @click="emit('zoomIn')"
        >
          <Plus :size="15" aria-hidden="true" />
        </button>
      </div>
    </section>

    <section v-else class="inspector-section selection-inspector">
      <h3>画布</h3>
      <dl>
        <div><dt>宽度</dt><dd>{{ outputLabel.split(" × ")[0] }} px</dd></div>
        <div><dt>高度</dt><dd>{{ outputLabel.split(" × ")[1] }} px</dd></div>
      </dl>
    </section>
  </aside>
</template>

<style scoped lang="scss">
.editor-inspector {
  width: 268px;
  min-height: 0;
  overflow: auto;
  border-left: 1px solid var(--line);
  background: var(--surface);
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.inspector-header {
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);

  span {
    color: var(--muted);
    font-size: 10px;
    font-weight: 600;
  }

  strong {
    color: var(--soft);
    font-size: 11px;
    font-weight: 650;
  }
}

.inspector-section {
  display: grid;
  gap: 16px;
  padding: 18px 16px;

  h3 {
    margin: 0;
    color: var(--text);
    font-size: 13px;
    font-weight: 660;
  }
}

.section-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.add-text-button,
.format-toggle {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--soft);
  background: var(--surface-subtle);
  font-size: 11px;
  font-weight: 600;

  &:hover:not(:disabled),
  &:focus-visible,
  &.active {
    border-color: var(--accent-border);
    color: var(--accent-strong);
    background: var(--accent-soft);
  }
}

.add-text-button {
  padding: 0 9px;
}

.format-toggle {
  width: 100%;
}

.ratio-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;

  button {
    min-width: 0;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--muted);
    background: var(--field);
    font-size: 10px;
    font-weight: 650;

    &:hover:not(:disabled),
    &:focus-visible,
    &.active {
      border-color: var(--accent-border);
      color: var(--accent-strong);
      background: var(--accent-soft);
    }
  }
}

.crop-size-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  > label {
    min-width: 0;
    display: grid;
    gap: 7px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 600;
  }
}

.crop-size-input {
  min-width: 0;
  height: 36px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--field);
  transition: border-color 180ms ease, box-shadow 180ms ease;

  &:focus-within {
    border-color: var(--accent-border);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  &.invalid {
    border-color: rgba(239, 125, 136, 0.62);
  }

  input {
    width: 100%;
    min-width: 0;
    height: 34px;
    padding: 0 4px 0 9px;
    border: 0;
    border-radius: 0;
    color: var(--text);
    background: transparent;
    box-shadow: none;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 650;

    &:hover,
    &:focus {
      border: 0;
      background: transparent;
      box-shadow: none;
      outline: 0;
    }
  }

  em {
    padding-right: 8px;
    color: var(--muted);
    font-size: 9px;
    font-style: normal;
    font-weight: 600;
  }
}

.inspector-actions {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: 8px;

  button {
    min-width: 0;
    padding-inline: 8px;
  }
}

.zoom-button-group {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 36px;
  gap: 7px;

  button {
    min-width: 0;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--soft);
    background: var(--field);
    font-size: 10px;
    font-weight: 650;

    &:hover:not(:disabled),
    &:focus-visible {
      border-color: var(--accent-border);
      color: var(--accent-strong);
      background: var(--accent-soft);
    }
  }
}

.range-control {
  display: grid;
  gap: 9px;

  > span {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  strong,
  output {
    font-size: 11px;
    font-weight: 600;
  }

  strong {
    color: var(--soft);
  }

  output {
    min-width: 34px;
    color: var(--muted);
    text-align: right;
  }

  input[type="range"] {
    width: 100%;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 0;
    accent-color: var(--accent);
    background: transparent;
    box-shadow: none;
    cursor: pointer;

    &:hover,
    &:focus {
      border: 0;
      background: transparent;
      box-shadow: none;
    }
  }
}

.color-control {
  display: grid;
  gap: 9px;
}

.control-label {
  color: var(--soft);
  font-size: 11px;
  font-weight: 600;
}

.color-swatches {
  display: grid;
  grid-template-columns: repeat(8, 24px);
  gap: 5px;
}

.color-swatch,
.custom-color {
  position: relative;
  width: 24px;
  height: 24px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
}

.color-swatch {
  &.active::after {
    content: "";
    position: absolute;
    inset: -4px;
    border: 2px solid var(--accent);
    border-radius: 7px;
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.custom-color {
  overflow: hidden;
  background: conic-gradient(#ef7d88, #e4a06b, #65d3ad, #65cfe0, #7898f5, #ef7d88);

  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }
}

.brush-preview {
  height: 46px;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--field);

  i {
    width: var(--brush-size);
    height: var(--brush-size);
    display: block;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
  }
}

.selection-inspector dl {
  display: grid;
  gap: 8px;
  margin: 0;

  div {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }

  dt,
  dd {
    margin: 0;
    font-size: 11px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    color: var(--soft);
    font-weight: 600;
  }
}

button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

button:disabled,
input:disabled {
  opacity: 0.42;
}

@media (max-width: 900px) {
  .editor-inspector {
    width: 100%;
    max-height: 250px;
    border-top: 1px solid var(--line);
    border-left: 0;
  }
}
</style>
