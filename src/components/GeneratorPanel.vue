<script setup lang="ts">
import { ImageUp, LayoutTemplate, Sparkles, Trash2, WandSparkles } from "lucide-vue-next";
import { sizePresets } from "@/constants/defaults";
import { chooseImageFile } from "@/services/desktop";
import type { GenerationMode, ImageParams, ImageSize, OutputFormat } from "@/types";

const props = defineProps<{
  mode: GenerationMode;
  params: ImageParams;
  loading: boolean;
}>();

const emit = defineEmits<{
  "update:params": [params: ImageParams];
  generate: [];
  clear: [];
  openTemplates: [];
}>();

const cost = 7;
const outputFormatOptions: Array<{ value: OutputFormat; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" }
];
const qualityOptions: Array<{ value: ImageParams["quality"]; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "low", label: "草稿" },
  { value: "medium", label: "标准" },
  { value: "high", label: "高清" }
];
function patch(partial: Partial<ImageParams>) {
  const next: ImageParams = {
    ...props.params,
    ...partial,
    model: "gpt-image-2",
    n: 1,
    background: "auto",
    outputCompression: Math.min(100, Math.max(1, partial.outputCompression ?? props.params.outputCompression))
  };
  emit("update:params", next);
}

function handleOutputFormatChange(outputFormat: OutputFormat) {
  patch({ outputFormat });
}

async function pickReference() {
  const selected = await chooseImageFile();
  if (selected) patch({ referenceImagePath: selected });
}
</script>

<template>
  <section class="generator-panel">
    <div class="panel-intro">
      <div>
        <span class="section-kicker"><Sparkles :size="13" /> CREATE</span>
        <h2>描述你的画面</h2>
      </div>
    </div>

    <div class="generator-scroll">
      <div v-if="mode === 'image-to-image'" class="upload-zone" @click="pickReference">
        <ImageUp :size="24" />
        <strong>{{ params.referenceImagePath ? "已选择参考图" : "上传参考图" }}</strong>
        <span>{{ params.referenceImagePath || "支持 PNG / JPG / WEBP" }}</span>
      </div>

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
          maxlength="32000"
          placeholder="描述主体、场景、构图、光线和风格"
          @input="patch({ prompt: ($event.target as HTMLTextAreaElement).value })"
        />
        <small>{{ params.prompt.length }} / 32000</small>
      </div>

      <div class="field size-field">
        <span>比例 / 尺寸</span>
        <div class="size-grid">
          <button
            v-for="preset in sizePresets"
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

      <div class="field">
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

      <label v-if="params.outputFormat !== 'png'" class="field compression-field">
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
      <span>预计消耗 {{ cost }} 积分</span>
      <button class="primary-button generate-button" :disabled="loading || !params.prompt.trim()" @click="emit('generate')">
        <WandSparkles :size="18" /> {{ loading ? "正在创作..." : "开始生成" }}
      </button>
    </div>
  </section>
</template>
