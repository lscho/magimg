<script setup lang="ts">
import { computed, onMounted, shallowRef, useTemplateRef } from "vue";
import { X } from "lucide-vue-next";
import { apiClient, ApiError } from "@/services/apiClient";

const emit = defineEmits<{ close: [] }>();
const dialog = useTemplateRef<HTMLElement>("dialog");
const content = shallowRef("");
const contact = shallowRef("");
const loading = shallowRef(false);
const error = shallowRef("");
const submitted = shallowRef(false);

const contentLength = computed(() => content.value.trim().length);
const canSubmit = computed(() => !loading.value && contentLength.value >= 1 && contentLength.value <= 2000);

onMounted(() => {
  dialog.value?.focus();
});

async function submit() {
  if (!canSubmit.value) return;
  loading.value = true;
  error.value = "";
  try {
    await apiClient.submitFeedback(content.value.trim(), contact.value.trim() || undefined);
    submitted.value = true;
  } catch (exception) {
    error.value = exception instanceof ApiError ? exception.message : "提交失败，请稍后重试。";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <Transition name="modal" appear>
      <section
        ref="dialog"
        class="modal feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
        tabindex="-1"
        @keydown.esc="emit('close')"
      >
        <button class="icon-button modal-close" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="16" />
        </button>

        <header>
          <span class="section-kicker">FEEDBACK</span>
          <h2 id="feedback-modal-title">提交反馈</h2>
          <p>你的意见将帮助我们改进产品。</p>
        </header>

        <div v-if="submitted" class="feedback-success" role="status">
          <p class="feedback-success-text">反馈已提交，感谢你的意见！</p>
          <button class="primary-button" type="button" @click="emit('close')">关闭</button>
        </div>

        <form v-else class="feedback-form" @submit.prevent="submit">
          <label class="feedback-field">
            <span class="feedback-label-row">
              反馈内容
              <span class="feedback-count" :class="{ 'is-over': contentLength > 2000 }">
                {{ contentLength }} / 2000
              </span>
            </span>
            <textarea
              v-model="content"
              class="feedback-textarea"
              rows="5"
              maxlength="2000"
              placeholder="描述你遇到的问题或建议…"
              required
            />
          </label>

          <label class="feedback-field">
            联系方式（选填）
            <input
              v-model="contact"
              class="feedback-input"
              type="text"
              maxlength="200"
              placeholder="QQ / 微信 / 邮箱"
            />
          </label>

          <p v-if="error" class="feedback-error" role="alert">{{ error }}</p>

          <button class="primary-button" type="submit" :disabled="!canSubmit">
            {{ loading ? "提交中..." : "提交反馈" }}
          </button>
        </form>
      </section>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.feedback-modal {
  width: min(440px, 100%);

  &:focus {
    outline: none;
  }
}

.feedback-form {
  display: grid;
  gap: 14px;
}

.feedback-field {
  display: grid;
  gap: 7px;
  color: var(--soft);
  font-size: 12px;
  font-weight: 600;
}

.feedback-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.feedback-count {
  color: var(--muted);
  font-size: 11px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;

  &.is-over {
    color: var(--danger);
  }
}

.feedback-textarea {
  width: 100%;
  min-height: 110px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--field);
  color: var(--text);
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;

  &:focus-visible {
    outline: none;
    border-color: var(--accent-border);
  }

  &::placeholder {
    color: var(--muted);
  }
}

.feedback-input {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--field);
  color: var(--text);
  font-size: 13px;

  &:focus-visible {
    outline: none;
    border-color: var(--accent-border);
  }

  &::placeholder {
    color: var(--muted);
  }
}

.feedback-error {
  margin: 0;
  color: var(--danger);
  font-size: 11px;
}

.feedback-success {
  display: grid;
  justify-items: center;
  gap: 16px;
  padding: 24px 0 8px;
}

.feedback-success-text {
  margin: 0;
  color: var(--success);
  font-size: 13px;
  font-weight: 600;
}
</style>
