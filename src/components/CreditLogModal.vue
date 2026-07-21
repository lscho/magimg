<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from "vue";
import { ArrowDownLeft, ArrowUpRight, Coins, Plus, RefreshCw, X } from "lucide-vue-next";
import { useAppStore } from "@/stores/app";
import type { CreditTransactionKind } from "@/types";

const emit = defineEmits<{ close: []; recharge: [] }>();
const app = useAppStore();
const dialog = useTemplateRef<HTMLElement>("dialog");

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
  dialog.value?.focus();
  void app.refreshTransactions();
});
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <section
      ref="dialog"
      class="modal credit-log-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-log-title"
      tabindex="-1"
      @keydown.esc="emit('close')"
    >
      <header class="credit-log-heading">
        <div>
          <h2 id="credit-log-title">积分日志</h2>
          <p>最近的积分收入与使用明细。</p>
        </div>
        <button class="icon-button" type="button" aria-label="关闭积分日志" @click="emit('close')">
          <X :size="18" />
        </button>
      </header>

      <div class="credit-log-summary">
        <div class="credit-log-icon"><Coins :size="22" /></div>
        <div>
          <span>当前可用积分</span>
          <strong>{{ app.balance.balance }}</strong>
        </div>
        <div class="credit-log-summary-actions">
          <button class="primary-small credit-recharge-button" type="button" @click="emit('recharge')">
            <Plus :size="15" />
            充值
          </button>
          <button class="icon-button" type="button" title="刷新积分记录" aria-label="刷新积分记录" @click="app.refreshTransactions">
            <RefreshCw :size="16" />
          </button>
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

<style scoped lang="scss">
.modal.credit-log-modal {
  width: min(560px, 100%);
  max-height: min(720px, calc(100vh - 48px));
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 14px;
  overflow: hidden;

  &:focus {
    outline: none;
  }
}

.credit-log-summary {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-subtle);

  span,
  strong {
    display: block;
  }

  span {
    color: var(--muted);
    font-size: 10px;
  }

  strong {
    margin-top: 2px;
    font-size: 22px;
    font-weight: 700;
  }
}

.credit-log-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(120, 152, 245, 0.2);
  border-radius: 7px;
  color: var(--accent-strong);
  background: var(--accent-soft);
}

.credit-log-summary-actions {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
}

.credit-recharge-button {
  min-height: 36px;
  padding: 0 11px;
}

.credit-log-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;

  h2 {
    margin: 0;
  }

  p {
    margin: 4px 0 0;
  }

  .icon-button {
    flex: 0 0 auto;
  }
}

.credit-log-list {
  min-height: 0;
  display: grid;
  align-content: start;
  overflow: auto;
  border-top: 1px solid var(--line);
  scrollbar-width: thin;
}

.credit-log-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 11px;
  padding: 13px 2px;
  border-bottom: 1px solid var(--line);
}

.credit-kind-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--success);
  background: rgba(101, 211, 173, 0.11);

  &.expense {
    color: var(--warm);
    background: rgba(228, 160, 107, 0.1);
  }
}

.credit-log-copy,
.credit-log-amount {
  strong,
  span {
    display: block;
  }
}

.credit-log-copy {
  strong {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.credit-log-copy span,
.credit-log-amount span {
  margin-top: 4px;
  color: var(--muted);
  font-size: 9px;
}

.credit-log-amount {
  text-align: right;

  strong {
    color: var(--success);
    font-size: 13px;
  }

  &.expense strong {
    color: var(--warm);
  }
}

.credit-log-loading {
  display: grid;
  gap: 9px;

  i {
    position: relative;
    overflow: hidden;
    height: 58px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface-subtle);

    &::after {
      content: "";
      position: absolute;
      inset: 0;
      transform: translateX(-100%);
      background: linear-gradient(
        100deg,
        transparent 20%,
        var(--accent-soft) 50%,
        transparent 80%
      );
      will-change: transform;
      animation: skeleton-sweep 1.6s ease-in-out infinite;
    }
  }
}

@keyframes skeleton-sweep {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
}

.modal-empty-state {
  min-height: 190px;
  display: grid;
  place-content: center;
  place-items: center;
  gap: 8px;
  padding: 24px;
  color: var(--muted);
  text-align: center;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: var(--surface-subtle);

  strong {
    color: var(--text);
    font-size: 13px;
  }

  span {
    font-size: 10px;
  }

  .secondary-button {
    width: auto;
    margin-top: 5px;
  }
}

@media (max-width: 600px) {
  .modal.credit-log-modal {
    max-height: calc(100vh - 24px);
    padding: 18px;
  }
}

@media (max-width: 420px) {
  .credit-log-item {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .credit-log-amount {
    grid-column: 2;
    text-align: left;
  }
}
</style>
