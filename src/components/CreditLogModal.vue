<script setup lang="ts">
import { computed, onMounted } from "vue";
import { ArrowDownLeft, ArrowUpRight, Coins, RefreshCw, X } from "lucide-vue-next";
import { useAppStore } from "@/stores/app";
import type { CreditTransactionKind } from "@/types";

const emit = defineEmits<{ close: [] }>();
const app = useAppStore();

const kindLabels: Record<CreditTransactionKind, string> = {
  recharge: "充值到账",
  generation: "生成消耗",
  refund: "积分退还",
  bonus: "系统赠送",
  adjustment: "余额调整"
};

const hasTransactions = computed(() => app.transactions.length > 0);

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

onMounted(() => {
  void app.refreshTransactions();
});
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section class="modal credit-log-modal" role="dialog" aria-modal="true" aria-labelledby="credit-log-title">
      <button class="icon-button modal-close" aria-label="关闭积分日志" @click="emit('close')"><X :size="18" /></button>

      <div class="credit-log-summary">
        <div class="credit-log-icon"><Coins :size="22" /></div>
        <div>
          <span>当前可用积分</span>
          <strong>{{ app.balance.balance }}</strong>
        </div>
        <button class="icon-button" title="刷新积分记录" aria-label="刷新积分记录" @click="app.refreshTransactions">
          <RefreshCw :size="16" />
        </button>
      </div>

      <div class="credit-log-heading">
        <div>
          <h2 id="credit-log-title">积分日志</h2>
          <p>最近的积分收入与使用明细。</p>
        </div>
      </div>

      <div v-if="app.transactionsLoading" class="credit-log-loading">
        <i v-for="item in 4" :key="item" />
      </div>
      <div v-else-if="app.transactionsError" class="modal-empty-state">
        <strong>暂时无法加载积分记录</strong>
        <span>{{ app.transactionsError }}</span>
        <button class="secondary-button" @click="app.refreshTransactions">重新加载</button>
      </div>
      <div v-else-if="hasTransactions" class="credit-log-list">
        <article v-for="item in app.transactions" :key="item.id" class="credit-log-item">
          <div class="credit-kind-icon" :class="{ expense: item.amount < 0 }">
            <ArrowUpRight v-if="item.amount < 0" :size="16" />
            <ArrowDownLeft v-else :size="16" />
          </div>
          <div class="credit-log-copy">
            <strong>{{ item.description }}</strong>
            <span>{{ kindLabels[item.kind] }} · {{ formatTime(item.createdAt) }}</span>
          </div>
          <div class="credit-log-amount" :class="{ expense: item.amount < 0 }">
            <strong>{{ item.amount > 0 ? "+" : "" }}{{ item.amount }}</strong>
            <span>结余 {{ item.balanceAfter }}</span>
          </div>
        </article>
      </div>
      <div v-else class="modal-empty-state">
        <Coins :size="30" />
        <strong>暂无积分记录</strong>
        <span>充值、生成和退款记录会显示在这里。</span>
      </div>
    </section>
  </div>
</template>
