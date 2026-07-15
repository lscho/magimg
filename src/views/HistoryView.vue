<script setup lang="ts">
import { Clock3, Trash2 } from "lucide-vue-next";
import { useAppStore } from "@/stores/app";

const app = useAppStore();
</script>

<template>
  <section class="page-view">
    <div class="page-heading">
      <div>
        <span class="section-kicker">LIBRARY</span>
        <h1>创作历史</h1>
        <p>按时间回看提示词、生成参数与作品。</p>
      </div>
      <button class="ghost-button danger" :disabled="!app.history.length" @click="app.clearHistory">
        <Trash2 :size="16" />
        清空历史
      </button>
    </div>

    <div v-if="app.visibleHistory.length" class="history-list">
      <article v-for="record in app.visibleHistory" :key="record.id" class="history-item">
        <img :src="record.images[0]?.remoteUrl" alt="历史图片" />
        <div>
          <div class="history-meta">
            <span>{{ record.mode === "text-to-image" ? "文生图" : "图生图" }}</span>
            <span>{{ new Date(record.createdAt).toLocaleString("zh-CN") }}</span>
            <span>-{{ record.costCredits }} 积分</span>
          </div>
          <h2>{{ record.params.prompt }}</h2>
          <p>{{ record.params.size }} · {{ record.params.n }} 张</p>
        </div>
      </article>
    </div>
    <div v-else class="empty-state full">
      <div class="empty-visual"><Clock3 :size="34" /></div>
      <strong>这里还没有作品</strong>
      <span>完成第一次生成后，作品与参数会自动保存在这里。</span>
    </div>
  </section>
</template>
