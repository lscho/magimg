<script setup lang="ts">
import { onMounted } from "vue";
import { ExternalLink, X } from "lucide-vue-next";
import { openExternal } from "@/services/desktop";
import { useAppStore } from "@/stores/app";

const emit = defineEmits<{ close: [] }>();
const app = useAppStore();

onMounted(() => {
  void app.refreshPackages();
});

async function buy(packageId: string) {
  const order = await app.createRechargeOrder(packageId);
  await openExternal(order.paymentUrl);
}
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal recharge-modal">
      <button class="icon-button modal-close" @click="emit('close')" aria-label="关闭">
        <X :size="18" />
      </button>
      <h2>积分充值</h2>
      <p>选择套餐后将打开外部浏览器完成支付，支付完成后刷新积分。</p>

      <div class="package-grid">
        <button
          v-for="item in app.packages"
          :key="item.id"
          class="package-option"
          :class="{ recommended: item.recommended }"
          @click="buy(item.id)"
        >
          <span>{{ item.title }}</span>
          <strong>{{ item.credits + item.bonusCredits }} 积分</strong>
          <small>¥{{ (item.priceCents / 100).toFixed(0) }}</small>
          <ExternalLink :size="16" />
        </button>
      </div>

      <button class="secondary-button" @click="app.refreshBalance">刷新积分</button>
    </section>
  </div>
</template>

<style scoped lang="scss">
.package-grid {
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
}

.package-option {
  position: relative;
  min-height: 78px;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 4px 12px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  text-align: left;
  background: var(--surface-subtle);

  &:hover {
    border-color: var(--line-strong);
    background: var(--surface-strong);
  }

  strong {
    font-size: 18px;
    font-weight: 650;
  }

  small {
    color: var(--accent-strong);
  }

  svg {
    grid-row: 1 / 3;
    grid-column: 2;
  }

  &.recommended {
    border-color: var(--accent-border);
    background: var(--accent-soft);
  }
}
</style>
