<script setup lang="ts">
import {
  Eraser,
  Hand,
  ImageDown,
  ImageOff,
  LoaderCircle,
  Minus,
  Plus,
  Redo2,
  Scan,
  ScanSearch,
  Spline,
  SquareDashed,
  Type,
  Trash2,
  Undo2
} from "lucide-vue-next";
import type { CutoutTool } from "@/composables/useCutoutSelection";
import {
  DEFAULT_SMART_SELECTION_THRESHOLD,
  SMART_SELECTION_THRESHOLD_MAX,
  SMART_SELECTION_THRESHOLD_MIN
} from "@/services/smartSelection";

const props = withDefaults(defineProps<{
  activeTool: CutoutTool;
  busy: boolean;
  ready: boolean;
  canClear: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoomPercent: number;
  importing: boolean;
  clearing: boolean;
  brushRadius: number;
  smartBrush: boolean;
  smartSelecting?: boolean;
  smartSelectionAvailable?: boolean;
  smartSelectionThreshold?: number;
  mode?: "cutout" | "auto-layer";
}>(), {
  mode: "cutout",
  smartSelecting: false,
  smartSelectionAvailable: true,
  smartSelectionThreshold: DEFAULT_SMART_SELECTION_THRESHOLD
});

const primaryTools = props.mode === "auto-layer"
  ? [
      { id: "box", label: "框选元素", icon: SquareDashed },
      { id: "text-box", label: "框选文字", icon: Type },
      { id: "pan", label: "拖动", icon: Hand }
    ]
  : [
      { id: "box", label: "框选", icon: SquareDashed },
      { id: "polygon", label: "点选轮廓", icon: Spline },
      { id: "erase", label: "背景修复", icon: Eraser },
      { id: "pan", label: "拖动", icon: Hand }
    ];

const emit = defineEmits<{
  selectTool: [tool: CutoutTool];
  clearSelections: [];
  importImage: [];
  clearImage: [];
  undo: [];
  redo: [];
  zoomIn: [];
  zoomOut: [];
  fitPreview: [];
  setBrushRadius: [radius: number];
  setSmartBrush: [enabled: boolean];
  smartSelect: [];
  updateSmartSelectionThreshold: [value: number];
}>();
</script>

<template>
  <aside class="cutout-toolbar" role="toolbar" aria-label="抠图工具">
    <div class="cutout-tool-group cutout-image-group is-import-group" aria-label="图片导入">
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="导入图片"
        aria-label="导入图片"
        :disabled="busy || importing || clearing"
        @click="emit('importImage')"
      >
        <ImageDown v-if="!importing" :size="18" aria-hidden="true" />
        <LoaderCircle v-else class="cutout-tool-spinner" :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="cutout-tool-group smart-selection-tool">
      <button
        class="cutout-tool-button smart-selection-button"
        type="button"
        :data-tooltip="smartSelectionAvailable ? undefined : '智能框选仅支持桌面客户端'"
        aria-label="智能框选"
        :aria-busy="smartSelecting"
        :disabled="busy || !ready || !smartSelectionAvailable"
        @click="emit('smartSelect')"
      >
        <LoaderCircle v-if="smartSelecting" class="cutout-tool-spinner" :size="18" aria-hidden="true" />
        <ScanSearch v-else :size="18" aria-hidden="true" />
      </button>
      <section
        v-if="smartSelectionAvailable"
        class="smart-selection-panel"
        role="group"
        aria-label="智能框选设置"
      >
        <label class="smart-selection-threshold">
          <span class="smart-selection-threshold-heading">
            <strong>智能框选强度</strong>
            <output>{{ Math.round(smartSelectionThreshold * 100) }}%</output>
          </span>
          <input
            type="range"
            :min="SMART_SELECTION_THRESHOLD_MIN"
            :max="SMART_SELECTION_THRESHOLD_MAX"
            step="0.01"
            :value="smartSelectionThreshold"
            aria-label="智能框选强度"
            :aria-valuetext="`${Math.round(smartSelectionThreshold * 100)}%，数值越高候选越少`"
            :disabled="busy || smartSelecting"
            @input="emit('updateSmartSelectionThreshold', Number(($event.target as HTMLInputElement).value))"
          />
          <span class="smart-selection-threshold-scale" aria-hidden="true">
            <span>更多</span>
            <span>更少</span>
          </span>
        </label>
      </section>
    </div>

    <div class="cutout-tool-group">
      <button
        v-for="tool in primaryTools"
        :key="tool.id"
        class="cutout-tool-button"
        :class="{ active: activeTool === tool.id }"
        type="button"
        :data-tooltip="tool.label"
        :aria-label="tool.label"
        :aria-pressed="activeTool === tool.id"
        :disabled="busy || !ready"
        @click="emit('selectTool', tool.id as CutoutTool)"
      >
        <component :is="tool.icon" :size="18" aria-hidden="true" />
      </button>
    </div>

    <section
      v-if="activeTool === 'erase'"
      class="cutout-brush-options"
      aria-label="背景修复属性"
    >
      <div class="cutout-option-row">
        <strong>背景修复</strong>
      </div>
      <label class="cutout-smart-option">
        <input
          type="checkbox"
          :checked="smartBrush"
          @change="emit('setSmartBrush', ($event.target as HTMLInputElement).checked)"
        />
        <span>智能吸附</span>
      </label>
      <label class="cutout-size-option">
        <span>大小 {{ brushRadius }} px</span>
        <input
          type="range"
          min="4"
          max="160"
          step="2"
          :value="brushRadius"
          @input="emit('setBrushRadius', Number(($event.target as HTMLInputElement).value))"
        />
      </label>
    </section>

    <div class="cutout-tool-group cutout-image-group" aria-label="图片操作">
      <button
        class="cutout-tool-button cutout-clear-button"
        type="button"
        data-tooltip="清空图片"
        aria-label="清空图片"
        :disabled="busy || importing || clearing || !ready"
        @click="emit('clearImage')"
      >
        <ImageOff v-if="!clearing" :size="18" aria-hidden="true" />
        <LoaderCircle v-else :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="cutout-tool-group cutout-zoom-group" aria-label="画布缩放">
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="缩小画布"
        aria-label="缩小画布"
        :disabled="busy || !ready || zoomPercent <= 25"
        @click="emit('zoomOut')"
      >
        <Minus :size="18" aria-hidden="true" />
      </button>
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="适应画布"
        aria-label="适应画布"
        :disabled="busy || !ready"
        @click="emit('fitPreview')"
      >
        <Scan :size="18" aria-hidden="true" />
      </button>
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="放大画布"
        aria-label="放大画布"
        :disabled="busy || !ready || zoomPercent >= 400"
        @click="emit('zoomIn')"
      >
        <Plus :size="18" aria-hidden="true" />
      </button>
    </div>

    <div class="cutout-tool-group cutout-history-group" aria-label="选区操作">
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="撤销"
        aria-label="撤销"
        :disabled="busy || !canUndo"
        @click="emit('undo')"
      >
        <Undo2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="重做"
        aria-label="重做"
        :disabled="busy || !canRedo"
        @click="emit('redo')"
      >
        <Redo2 :size="18" aria-hidden="true" />
      </button>
      <button
        class="cutout-tool-button"
        type="button"
        data-tooltip="清除全部选区"
        aria-label="清除全部选区"
        :disabled="busy || !canClear"
        @click="emit('clearSelections')"
      >
        <Trash2 :size="18" aria-hidden="true" />
      </button>
    </div>
  </aside>
</template>

<style scoped lang="scss">
.cutout-toolbar {
  position: relative;
  z-index: 2;
  width: 44px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  padding: 0;
  border-right: 1px solid var(--line);
  background: var(--surface);
}

.cutout-tool-spinner { animation: cutout-tool-spin 900ms linear infinite; }

@keyframes cutout-tool-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .cutout-tool-spinner { animation: none; }
}

.cutout-brush-options {
  position: absolute;
  z-index: 25;
  top: 0;
  left: 44px;
  width: 224px;
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line-strong);
  border-radius: 0 7px 7px 0;
  color: var(--soft);
  background: rgba(16, 22, 29, 0.98);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.34);
  font-size: 11px;
}

.cutout-option-row,
.cutout-smart-option,
.cutout-size-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cutout-option-row strong {
  color: var(--text);
  font-size: 11px;
}

.cutout-smart-option {
  justify-content: flex-start;

  input {
    position: relative;
    flex: 0 0 auto;
    width: 30px;
    height: 16px;
    margin: 0;
    appearance: none;
    border: 1px solid var(--line-strong);
    border-radius: 8px;
    background: var(--field);
    cursor: pointer;

    &::after {
      content: "";
      position: absolute;
      top: 2px;
      left: 2px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--muted);
      transition: transform 140ms ease, background 140ms ease;
    }

    &:checked {
      border-color: var(--accent-border);
      background: var(--accent-soft);
    }

    &:checked::after {
      background: var(--accent);
      transform: translateX(14px);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }
}

.cutout-size-option {
  align-items: stretch;
  flex-direction: column;

  input { width: 100%; }
}

.cutout-tool-group {
  width: 100%;
  display: grid;
  place-items: stretch;
  gap: 0;
}

.smart-selection-tool {
  position: relative;

  &:hover .smart-selection-panel,
  &:focus-within .smart-selection-panel {
    opacity: 1;
    pointer-events: auto;
    transform: translateX(0);
    visibility: visible;
  }
}

.smart-selection-button:not([data-tooltip])::after {
  display: none;
}

.smart-selection-panel {
  position: absolute;
  z-index: 35;
  top: 0;
  left: 43px;
  width: 220px;
  padding: 11px 12px 9px;
  border: 1px solid var(--line-strong);
  border-radius: 0 7px 7px 0;
  color: var(--soft);
  background: rgba(16, 22, 29, 0.98);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.34);
  opacity: 0;
  pointer-events: none;
  transform: translateX(-4px);
  transition: opacity 140ms ease, transform 140ms ease, visibility 140ms ease;
  visibility: hidden;
}

.smart-selection-threshold {
  display: grid;
  gap: 6px;

  input[type="range"] {
    width: 100%;
    height: 20px;
    margin: 0;
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

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.42;
    }
  }
}

.smart-selection-threshold-heading,
.smart-selection-threshold-scale {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.smart-selection-threshold-heading {
  color: var(--soft);
  font-size: 11px;

  strong { font-weight: 650; }
  output {
    min-width: 32px;
    color: var(--accent-strong);
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    text-align: right;
  }
}

.smart-selection-threshold-scale {
  color: var(--muted);
  font-size: 9px;
}

.cutout-zoom-group,
.cutout-history-group {
  border-top: 1px solid var(--line);
}

.is-import-group + .smart-selection-tool,
.cutout-image-group:not(.is-import-group) {
  border-top: 1px solid var(--line);
}

.cutout-history-group {
  margin-top: auto;
}

.cutout-tool-button {
  position: relative;
  width: 100%;
  height: 36px;
  display: grid;
  place-items: center;
  border: 0;
  border-left: 2px solid transparent;
  border-radius: 0;
  color: var(--muted);
  background: transparent;
  transition:
    color 160ms ease,
    border-color 160ms ease,
    background 160ms ease;

  &::after {
    content: attr(data-tooltip);
    position: absolute;
    z-index: 30;
    top: 50%;
    left: calc(100% + 6px);
    width: max-content;
    max-width: 180px;
    padding: 5px 7px;
    border: 1px solid var(--line-strong);
    border-radius: 5px;
    color: var(--text);
    background: rgba(16, 22, 29, 0.98);
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.34);
    font-size: 10px;
    font-weight: 600;
    line-height: 1.2;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-50%);
    visibility: hidden;
    white-space: nowrap;
  }

  &:hover::after,
  &:focus-visible::after {
    opacity: 1;
    visibility: visible;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    color: var(--text);
    background: var(--surface-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  &.active {
    border-left-color: var(--accent);
    color: var(--accent-strong);
    background: var(--accent-soft);
  }

  &:disabled {
    cursor: not-allowed;

    > svg {
      opacity: 0.38;
    }
  }
}

@media (max-height: 760px) {
  .cutout-tool-button {
    height: 31px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cutout-smart-option input::after {
    transition: none;
  }

  .smart-selection-panel {
    transition: none;
  }
}
</style>
