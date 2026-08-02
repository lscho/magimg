<script setup lang="ts">
import { MonitorX } from "lucide-vue-next";
import CompressionWorkspace from "@/components/compression/CompressionWorkspace.vue";
import { isDesktopRuntime } from "@/services/imageCompression";

const desktopAvailable = isDesktopRuntime();
</script>

<template>
  <CompressionWorkspace v-if="desktopAvailable" />
  <section v-else class="desktop-unavailable" aria-labelledby="compression-unavailable-title">
    <MonitorX :size="28" aria-hidden="true" />
    <h1 id="compression-unavailable-title">图片压缩仅在桌面客户端可用</h1>
    <p>请在幻画 AI 桌面客户端中选择本地图片或文件夹。</p>
  </section>
</template>

<style scoped lang="scss">
.desktop-unavailable {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  color: var(--muted);
  text-align: center;

  h1 {
    margin: 4px 0 0;
    color: var(--text);
    font-size: 16px;
    font-weight: 680;
  }

  p {
    margin: 0;
    font-size: 12px;
  }
}
</style>
