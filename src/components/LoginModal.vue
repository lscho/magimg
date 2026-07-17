<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef, useTemplateRef } from "vue";
import { X } from "lucide-vue-next";
import { useAppStore } from "@/stores/app";

type AuthMode = "login" | "register" | "reset";

const props = defineProps<{
  context?: "generation";
}>();
const emit = defineEmits<{ close: [] }>();
const app = useAppStore();
const dialog = useTemplateRef<HTMLElement>("dialog");
const phone = shallowRef("");
const password = shallowRef("");
const code = shallowRef("");
const mode = shallowRef<AuthMode>("login");
const loading = shallowRef(false);
const codeLoading = shallowRef(false);
const cooldownSeconds = shallowRef(0);
const error = shallowRef("");
const success = shallowRef("");
let cooldownTimer: number | undefined;

const title = computed(() => {
  if (mode.value === "register") return "创建账号";
  if (mode.value === "reset") return "重置密码";
  return "登录幻画 AI";
});
const needsCode = computed(() => mode.value !== "login");
const description = computed(() =>
  props.context === "generation" ? "登录后才能开始生成图片。" : "使用中国大陆手机号继续。"
);
const submitLabel = computed(() => {
  if (loading.value) return "处理中...";
  if (mode.value === "register") return "注册并登录";
  if (mode.value === "reset") return "重置密码";
  return "登录";
});
const canSubmit = computed(
  () =>
    !loading.value &&
    /^1[3-9]\d{9}$/u.test(phone.value) &&
    password.value.length >= 8 &&
    (!needsCode.value || /^\d{6}$/u.test(code.value))
);

onMounted(() => {
  dialog.value?.focus();
});

onUnmounted(() => {
  if (cooldownTimer !== undefined) window.clearInterval(cooldownTimer);
});

function switchMode(nextMode: AuthMode) {
  mode.value = nextMode;
  code.value = "";
  error.value = "";
  success.value = "";
}

async function sendCode() {
  codeLoading.value = true;
  error.value = "";
  success.value = "";
  try {
    const response = await app.sendSms(phone.value, mode.value === "register" ? "register" : "passwordReset");
    cooldownSeconds.value = response.cooldownSeconds;
    success.value = "验证码已发送";
    if (cooldownTimer !== undefined) window.clearInterval(cooldownTimer);
    cooldownTimer = window.setInterval(() => {
      cooldownSeconds.value = Math.max(0, cooldownSeconds.value - 1);
      if (cooldownSeconds.value === 0 && cooldownTimer !== undefined) {
        window.clearInterval(cooldownTimer);
        cooldownTimer = undefined;
      }
    }, 1000);
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : "验证码发送失败";
  } finally {
    codeLoading.value = false;
  }
}

async function submit() {
  loading.value = true;
  error.value = "";
  success.value = "";
  try {
    if (mode.value === "register") {
      await app.register(phone.value, code.value, password.value);
      emit("close");
      return;
    }
    if (mode.value === "reset") {
      await app.resetPassword(phone.value, code.value, password.value);
      switchMode("login");
      success.value = "密码已重置，请使用新密码登录";
      return;
    }
    await app.login(phone.value, password.value);
    emit("close");
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : "登录失败";
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
        class="modal compact-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        tabindex="-1"
        @keydown.esc="emit('close')"
      >
        <button class="icon-button modal-close" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="18" />
        </button>
        <h2 id="auth-modal-title">{{ title }}</h2>
        <p>{{ description }}</p>

        <form class="auth-form" @submit.prevent="submit">
          <label>
            手机号
            <input v-model="phone" type="tel" inputmode="numeric" maxlength="11" autocomplete="tel" />
          </label>
          <label v-if="needsCode">
            短信验证码
            <span class="code-field">
              <input v-model="code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" />
              <button
                class="ghost-button code-button"
                type="button"
                :disabled="codeLoading || cooldownSeconds > 0 || !/^1[3-9]\d{9}$/u.test(phone)"
                @click="sendCode"
              >
                {{ cooldownSeconds > 0 ? `${cooldownSeconds} 秒` : codeLoading ? "发送中..." : "发送验证码" }}
              </button>
            </span>
          </label>
          <label>
            {{ mode === "reset" ? "新密码" : "密码" }}
            <input
              v-model="password"
              type="password"
              minlength="8"
              maxlength="128"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            />
          </label>

          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
          <p v-if="success" class="form-success" role="status">{{ success }}</p>
          <button class="primary-button" type="submit" :disabled="!canSubmit">{{ submitLabel }}</button>
        </form>

        <div class="auth-switch-row">
          <button v-if="mode !== 'login'" class="text-button auth-switch" type="button" @click="switchMode('login')">
            返回登录
          </button>
          <button v-if="mode === 'login'" class="text-button auth-switch" type="button" @click="switchMode('register')">
            注册账号
          </button>
          <button v-if="mode === 'login'" class="text-button auth-switch" type="button" @click="switchMode('reset')">
            忘记密码
          </button>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.compact-modal {
  width: min(420px, 100%);

  &:focus {
    outline: none;
  }
}

.auth-form {
  display: grid;
  gap: 14px;
}

.code-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 112px;
  gap: 8px;
}

.code-button {
  width: 112px;
  height: 42px;
  padding: 0 10px;
  font-size: 11px;
}

.auth-switch-row {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-top: 14px;
}

.auth-switch {
  min-height: 32px;
  justify-content: center;
  padding: 0;
}

.form-error,
.form-success {
  margin: 0;
  font-size: 11px;
}

.form-error {
  color: var(--danger) !important;
}

.form-success {
  color: var(--success) !important;
}

@media (max-width: 420px) {
  .code-field {
    grid-template-columns: 1fr;
  }

  .code-button {
    width: 100%;
  }
}
</style>
