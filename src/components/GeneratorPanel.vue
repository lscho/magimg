<script setup lang="ts">
import { computed } from "vue";
import { ImageUp, LayoutTemplate, Sparkles, Trash2, WandSparkles } from "lucide-vue-next";
import { sizePresets } from "@/constants/defaults";
import { chooseImageFile } from "@/services/desktop";
import type {
  GenerationMode,
  ImageParams,
  ImageSize,
  OutputFormat,
  SelectedImageFile,
  SupportedQuality,
  GenerationSettings
} from "@/types";

const props = defineProps<{
  mode: GenerationMode;
  loading: boolean;
  cost: number;
  error: string;
  showOutputOptions: boolean;
  maxPromptLength: number;
  supportedQualities: SupportedQuality[];
  uploadMaxBytes: number;
  sizeRules: GenerationSettings["sizeRules"];
}>();
const params = defineModel<ImageParams>("params", { required: true });

const emit = defineEmits<{
  generate: [];
  clear: [];
  openTemplates: [];
  referenceSelected: [image: SelectedImageFile];
}>();

const outputFormatOptions: Array<{ value: OutputFormat; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" }
];
const allQualityOptions: Array<{ value: SupportedQuality; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "low", label: "草稿" },
  { value: "medium", label: "标准" },
  { value: "high", label: "高清" }
];
const qualityOptions = computed(() =>
  allQualityOptions.filter((option) => props.supportedQualities.includes(option.value))
);
const supportedSizePresets = computed(() =>
  sizePresets.filter((preset) => {
    if (preset.value === "auto") return true;
    const [width, height] = preset.value.split("x").map(Number);
    const pixels = width * height;
    return (
      width % props.sizeRules.edgeStep === 0 &&
      height % props.sizeRules.edgeStep === 0 &&
      Math.max(width, height) <= props.sizeRules.maxEdge &&
      Math.max(width, height) / Math.min(width, height) <= props.sizeRules.maxAspectRatio &&
      pixels >= props.sizeRules.minPixels &&
      pixels <= props.sizeRules.maxPixels
    );
  })
);
const modeTitle = computed(() => (props.mode === "image-to-image" ? "图生图" : "文生图"));

function patch(partial: Partial<ImageParams>) {
  const next: ImageParams = {
    ...params.value,
    ...partial,
    model: "gpt-image-2",
    n: 1,
    background: "auto",
    outputCompression: Math.min(100, Math.max(1, partial.outputCompression ?? params.value.outputCompression))
  };
  params.value = next;
}

function handleOutputFormatChange(outputFormat: OutputFormat) {
  patch({ outputFormat });
}

async function pickReference() {
  const selected = await chooseImageFile();
  if (selected) {
    patch({ referenceImagePath: selected.path });
    emit("referenceSelected", selected);
  }
}
</script>

<template>
  <section class="generator-panel">
    <div class="panel-intro">
      <div>
        <span class="section-kicker"><Sparkles :size="13" /> CREATE</span>
        <h2>{{ modeTitle }}</h2>
      </div>
    </div>

    <div class="generator-scroll">
      <button v-if="mode === 'image-to-image'" class="upload-zone" type="button" @click="pickReference">
        <ImageUp :size="24" />
        <strong>{{ params.referenceImagePath ? "已选择参考图" : "上传参考图" }}</strong>
        <span>
          {{
            params.referenceImagePath ||
            `支持 PNG / JPG / WEBP，最大 ${Math.floor(uploadMaxBytes / 1024 / 1024)} MB`
          }}
        </span>
      </button>

      <div class="field prompt-field">
        <span>
          提示词
          <span class="prompt-actions">
            <button class="inline-action template-trigger" type="button" @click="emit('openTemplates')">
              <LayoutTemplate :size="14" /> 模板
            </button>
            <button class="inline-action" type="button" @click="emit('clear')"><Trash2 :size="14" /> 清空</button>
          </span>
        </span>
        <textarea
          :value="params.prompt"
          aria-label="提示词"
          :maxlength="maxPromptLength"
          placeholder="描述主体、场景、构图、光线和风格"
          @input="patch({ prompt: ($event.target as HTMLTextAreaElement).value })"
        />
        <small>{{ params.prompt.length }} / {{ maxPromptLength }}</small>
      </div>

      <div class="field size-field">
        <span>比例 / 尺寸</span>
        <div class="size-grid">
          <button
            v-for="preset in supportedSizePresets"
            :key="preset.value"
            type="button"
            class="size-option"
            :class="{ active: params.size === preset.value }"
            @click="patch({ size: preset.value as ImageSize })"
          >
            <i :class="`shape-${preset.shape}`" />
            <strong>{{ preset.ratio }}</strong>
            <small>{{ preset.label }}</small>
          </button>
        </div>
      </div>

      <div v-if="showOutputOptions" class="field">
        <span>输出格式</span>
        <div class="radio-group format-radio-group" role="radiogroup" aria-label="输出格式">
          <label
            v-for="format in outputFormatOptions"
            :key="format.value"
            class="radio-option"
            :class="{ active: params.outputFormat === format.value }"
          >
            <input
              type="radio"
              name="output-format"
              :value="format.value"
              :checked="params.outputFormat === format.value"
              @change="handleOutputFormatChange(format.value)"
            />
            <span>{{ format.label }}</span>
          </label>
        </div>
      </div>

      <label v-if="showOutputOptions && params.outputFormat !== 'png'" class="field compression-field">
        <span>压缩比例 <em>{{ params.outputCompression }}%</em></span>
        <input
          type="range"
          min="1"
          max="100"
          :value="params.outputCompression"
          @input="patch({ outputCompression: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="range-limits"><small>1%</small><small>100%</small></span>
      </label>

      <div class="field">
        <span>质量</span>
        <div class="radio-group quality-radio-group" role="radiogroup" aria-label="质量">
          <label
            v-for="quality in qualityOptions"
            :key="quality.value"
            class="radio-option"
            :class="{ active: params.quality === quality.value }"
          >
            <input
              type="radio"
              name="quality"
              :value="quality.value"
              :checked="params.quality === quality.value"
              @change="patch({ quality: quality.value })"
            />
            <span>{{ quality.label }}</span>
          </label>
        </div>
      </div>
    </div>

    <div class="generator-footer">
      <p v-if="error" class="generator-error" role="alert">{{ error }}</p>
      <span>预计消耗 {{ cost }} 积分</span>
      <button
        class="primary-button generate-button"
        :disabled="loading || !params.prompt.trim() || (mode === 'image-to-image' && !params.referenceImagePath)"
        @click="emit('generate')"
      >
        <WandSparkles :size="18" /> {{ loading ? "正在创作..." : "开始生成" }}
      </button>
    </div>
  </section>
</template>

<style scoped lang="scss">
.generator-panel {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  overflow: hidden;
  border: 0;
  border-left: 1px solid var(--line);
  border-radius: 0;
  background: var(--surface);
  box-shadow: none;
}

.panel-intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 20px 18px 14px;

  h2 {
    margin: 4px 0 0;
    color: var(--text);
    font-size: 18px;
    font-weight: 660;
    letter-spacing: 0;
  }
}

.generator-scroll {
  min-height: 0;
  overflow: auto;
  padding: 0 18px 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.field {
  position: relative;
  display: grid;
  gap: 7px;
  margin: 0 0 12px;
  color: var(--soft);
  font-size: 12px;
  font-weight: 600;

  > span {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  small {
    position: absolute;
    right: 10px;
    bottom: 9px;
    color: var(--muted);
    font-size: 10px;
    font-weight: 500;
  }
}

.prompt-field textarea {
  min-height: 112px;
  padding-bottom: 28px;
}

.prompt-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.template-trigger {
  color: var(--accent-strong);
}

.size-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}

.size-option {
  min-width: 0;
  height: 78px;
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 24px 18px 14px;
  align-items: center;
  justify-items: center;
  gap: 2px;
  padding: 7px 3px 6px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--muted);
  text-align: center;
  background: var(--surface-subtle);
  box-shadow: none;

  &:hover {
    color: var(--text);
    border-color: var(--line-strong);
    background: var(--surface-strong);
  }

  &.active {
    color: var(--accent-strong);
    border-color: var(--accent-border);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px rgba(120, 152, 245, 0.06);

    i {
      color: var(--accent);
    }
  }

  i {
    justify-self: center;
    display: block;
    border: 2px solid currentcolor;
    border-radius: 2px;
    color: #778292;
  }

  .shape-auto {
    width: 22px;
    height: 22px;
    border-style: dashed;
  }

  .shape-square {
    width: 21px;
    height: 21px;
  }

  .shape-landscape {
    width: 26px;
    height: 17px;
  }

  .shape-portrait {
    width: 16px;
    height: 24px;
  }

  .shape-wide {
    width: 27px;
    height: 14px;
  }

  .shape-tall {
    width: 14px;
    height: 26px;
  }

  strong {
    align-self: center;
    font-size: 13px;
    white-space: nowrap;
  }
}

.field .size-option small {
  position: static;
  align-self: center;
  color: var(--muted);
  font-size: 9px;
  white-space: nowrap;
}

.compression-field {
  > span em {
    color: var(--accent-strong);
    font-style: normal;
    font-weight: 700;
  }

  input[type="range"] {
    height: 22px;
    padding: 0;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .range-limits {
    margin-top: -3px;
  }
}

.field .range-limits small {
  position: static;
  color: var(--muted);
  font-size: 10px;
  font-weight: 500;
}

.radio-group {
  display: grid;
  gap: 7px;
}

.format-radio-group {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.quality-radio-group {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.radio-option {
  position: relative;
  min-width: 0;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--muted);
  background: var(--surface-subtle);
  box-shadow: none;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;

  &:hover {
    color: var(--text);
    border-color: var(--line-strong);
    background: var(--surface-strong);
  }

  &.active {
    color: var(--accent-strong);
    border-color: var(--accent-border);
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px rgba(120, 152, 245, 0.06);
  }

  &:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  input {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    opacity: 0;
    pointer-events: none;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.upload-zone {
  width: 100%;
  min-height: 108px;
  display: grid;
  place-items: center;
  gap: 5px;
  margin-bottom: 15px;
  border: 1px dashed rgba(101, 207, 224, 0.42);
  border-radius: 7px;
  color: var(--tech-cyan);
  background: rgba(101, 207, 224, 0.07);
  cursor: pointer;
  transition:
    border-color 180ms ease,
    background 180ms ease;

  &:hover {
    border-color: rgba(101, 207, 224, 0.7);
    background: rgba(101, 207, 224, 0.1);
  }

  span {
    max-width: 90%;
    overflow: hidden;
    color: var(--muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.generator-footer {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  padding: 12px 18px 16px;
  border-top: 1px solid var(--line);
  background: #0d131a;

  > span {
    color: var(--muted);
    font-size: 11px;
  }
}

.generator-error {
  margin: 0;
  color: var(--danger);
  font-size: 11px;
  line-height: 1.45;
}

@media (max-width: 900px) {
  .generator-panel {
    max-height: none;
    border-top: 1px solid var(--line);
    border-left: 0;
  }

  .generator-scroll {
    overflow: visible;
  }
}

@media (max-width: 600px) {
  .panel-intro {
    padding: 16px;
  }

  .generator-scroll {
    padding-right: 16px;
    padding-left: 16px;
  }

  .generator-footer {
    padding: 13px 16px 16px;
  }

  .size-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
