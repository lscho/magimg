<script setup lang="ts">
import { ref } from "vue";
import { X } from "lucide-vue-next";
import { useAppStore } from "@/stores/app";

const emit = defineEmits<{ close: [] }>();
const app = useAppStore();
const email = ref("demo@huanhua.ai");
const password = ref("12345678");
const isRegister = ref(false);
const loading = ref(false);
const error = ref("");

async function submit() {
  loading.value = true;
  error.value = "";
  try {
    await app.login(email.value, password.value, isRegister.value);
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
      <section class="modal compact-modal">
        <button class="icon-button modal-close" @click="emit('close')" aria-label="关闭">
          <X :size="18" />
        </button>
        <h2>{{ isRegister ? "创建账号" : "登录幻画 AI" }}</h2>
        <p>使用账号同步积分与生成权限，本地历史仍保存在当前设备。</p>

        <label>
          邮箱
          <input v-model="email" type="email" autocomplete="email" />
        </label>
        <label>
          密码
          <input v-model="password" type="password" autocomplete="current-password" />
        </label>

        <p v-if="error" class="form-error">{{ error }}</p>
        <button class="primary-button" :disabled="loading" @click="submit">
          {{ loading ? "处理中..." : isRegister ? "注册并登录" : "登录" }}
        </button>
        <div class="auth-switch-row">
          <button class="text-button auth-switch" @click="isRegister = !isRegister">
            {{ isRegister ? "已有账号，去登录" : "没有账号，立即注册" }}
          </button>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.compact-modal {
  width: min(420px, 100%);
}

.auth-switch-row {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}

.auth-switch {
  min-height: 32px;
  justify-content: center;
  padding: 0;
}

.form-error {
  color: var(--danger) !important;
}
</style>
