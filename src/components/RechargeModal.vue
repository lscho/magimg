<script setup lang="ts">
import { computed, onMounted, shallowRef, useTemplateRef } from "vue";
import { ExternalLink, KeyRound, X } from "lucide-vue-next";
import { openExternal } from "@/services/desktop";
import { useAppStore } from "@/stores/app";

const emit = defineEmits<{ close: [] }>();
const app = useAppStore();
const dialog = useTemplateRef<HTMLElement>("dialog");
const code = shallowRef("");
const loading = shallowRef(false);
const error = shallowRef("");
const success = shallowRef("");
const normalizedCode = computed(() => code.value.toUpperCase().replace(/\s+/gu, ""));
const cardPurchaseUrl = computed(() => {
  const target = app.capabilities.cardPurchaseUrl?.trim() || "";
  if (!target) return "";
  try {
    const url = new URL(target);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url.toString() : "";
  } catch {
    return "";
  }
});

onMounted(() => {
  dialog.value?.focus();
});

async function redeem() {
  loading.value = true;
  error.value = "";
  success.value = "";
  try {
    const result = await app.redeemCard(normalizedCode.value);
    success.value = `已充值 ${result.points} 积分，当前余额 ${result.balance}`;
    code.value = "";
  } catch (exception) {
    error.value = exception instanceof Error ? exception.message : "卡密兑换失败";
  } finally {
    loading.value = false;
  }
}

async function purchaseCard() {
  if (!cardPurchaseUrl.value) return;
  error.value = "";
  try {
    await openExternal(cardPurchaseUrl.value);
  } catch {
    error.value = "购买页面无法打开，请稍后重试。";
  }
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section
      ref="dialog"
      class="modal recharge-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recharge-modal-title"
      tabindex="-1"
      @keydown.esc="emit('close')"
    >
      <button class="icon-button modal-close" type="button" aria-label="关闭" @click="emit('close')">
        <X :size="18" />
      </button>
      <div class="recharge-heading">
        <div><KeyRound :size="20" /></div>
        <div>
          <h2 id="recharge-modal-title">卡密充值</h2>
          <p>输入卡密兑换积分。</p>
        </div>
      </div>

      <form class="recharge-form" @submit.prevent="redeem">
        <label for="recharge-code">
          卡密
          <input
            id="recharge-code"
            v-model="code"
            type="text"
            maxlength="32"
            autocomplete="off"
            placeholder="请输入卡密"
          />
        </label>
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="success" class="form-success" role="status">{{ success }}</p>
        <div class="recharge-actions">
          <button class="primary-button" type="submit" :disabled="loading || normalizedCode.length < 8">
            {{ loading ? "兑换中..." : "兑换积分" }}
          </button>
          <button v-if="cardPurchaseUrl" class="text-button purchase-card-link" type="button" @click="purchaseCard">
            购买卡密
            <ExternalLink :size="14" />
          </button>
        </div>
      </form>
    </section>
  </div>
</template>

<style scoped lang="scss">
.recharge-modal {
  width: min(440px, 100%);

  &:focus {
    outline: none;
  }
}

.recharge-heading {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding-right: 42px;

  > div:first-child {
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    border: 1px solid var(--accent-border);
    border-radius: 7px;
    color: var(--accent-strong);
    background: var(--accent-soft);
  }

  h2 {
    margin: 0;
  }

  p {
    margin: 5px 0 18px;
  }
}

.recharge-form {
  display: grid;
  gap: 14px;
}

.recharge-actions {
  display: grid;
  gap: 7px;
}

.purchase-card-link {
  min-height: 30px;
  justify-self: center;
  padding: 0 6px;
  color: var(--accent-strong);
  font-weight: 600;
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
</style>
