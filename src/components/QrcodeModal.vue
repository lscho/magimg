<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from "vue";
import { X } from "lucide-vue-next";
import { apiClient, resolveApiAssetUrl } from "@/services/apiClient";

const emit = defineEmits<{ close: [] }>();
const dialog = useTemplateRef<HTMLElement>("dialog");
const qrcodeUrl = shallowRef("");
const loading = shallowRef(true);
const error = shallowRef("");

onMounted(async () => {
  dialog.value?.focus();
  try {
    const config = await apiClient.config();
    const raw = config.groupQrcode;
    if (raw) {
      qrcodeUrl.value = resolveApiAssetUrl(raw);
    } else {
      error.value = "暂未配置群聊二维码。";
    }
  } catch {
    error.value = "获取二维码失败，请稍后重试。";
  } finally {
    loading.value = false;
  }
});

function onImageError() {
  error.value = "二维码图片加载失败。";
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <Transition name="modal" appear>
      <section
        ref="dialog"
        class="modal qrcode-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qrcode-modal-title"
        tabindex="-1"
        @keydown.esc="emit('close')"
      >
        <button class="icon-button modal-close" type="button" aria-label="关闭" @click="emit('close')">
          <X :size="16" />
        </button>

        <header>
          <span class="section-kicker">SUPPORT</span>
          <h2 id="qrcode-modal-title">加入群聊</h2>
          <p>扫码加入群聊，获取帮助与反馈</p>
        </header>

        <div class="qrcode-body">
          <div v-if="loading" class="qrcode-loading" aria-label="加载中">
            <span class="spinner" aria-hidden="true" />
          </div>

          <template v-else-if="!error && qrcodeUrl">
            <img
              class="qrcode-image"
              :src="qrcodeUrl"
              alt="群聊二维码"
              width="200"
              height="200"
              @error="onImageError"
            />
          </template>

          <p v-else class="qrcode-error" role="alert">{{ error }}</p>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
.qrcode-modal {
  width: min(360px, 100%);
  text-align: center;

  &:focus {
    outline: none;
  }
}

.qrcode-body {
  display: grid;
  justify-items: center;
  gap: 14px;
  padding-top: 20px;
}

.qrcode-loading {
  display: grid;
  place-items: center;
  width: 200px;
  height: 200px;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.qrcode-image {
  width: 200px;
  height: 200px;
  border: 1px solid var(--line);
  border-radius: 8px;
  object-fit: contain;
  background: #fff;
}

.qrcode-error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
