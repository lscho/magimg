<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import {
  Coins,
  History,
  ImagePlus,
  LayoutTemplate,
  LogIn,
  Menu,
  Settings,
  Sparkles,
  Wand2
} from "lucide-vue-next";
import LoginModal from "@/components/LoginModal.vue";
import RechargeModal from "@/components/RechargeModal.vue";
import CreditLogModal from "@/components/CreditLogModal.vue";
import SettingsModal from "@/components/SettingsModal.vue";
import { useAppStore } from "@/stores/app";

const app = useAppStore();
const route = useRoute();
const showLogin = shallowRef(false);
const showRecharge = shallowRef(false);
const showCreditLog = shallowRef(false);
const showSettings = shallowRef(false);
const sidebarOpen = shallowRef(false);

onMounted(() => {
  void app.init();
});

const currentMode = computed(() => route.params.mode);

function closeSidebar() {
  sidebarOpen.value = false;
}

function openSettings() {
  showSettings.value = true;
  closeSidebar();
}

function openRechargeFromCreditLog() {
  showCreditLog.value = false;
  showRecharge.value = true;
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header" data-tauri-drag-region>
      <button class="mobile-menu" type="button" aria-label="打开导航" @click="sidebarOpen = true">
        <Menu :size="20" />
      </button>
      <div class="app-title" aria-label="幻画 AI">
        <span class="app-title-mark" aria-hidden="true">幻</span>
        <strong>幻画 AI</strong>
      </div>
    </header>

    <div class="workspace" :class="{ 'sidebar-is-open': sidebarOpen }">
      <aside class="sidebar" aria-label="主导航">
        <div class="rail-brand" aria-hidden="true">
          <Sparkles :size="21" />
        </div>

        <nav class="main-nav" aria-label="创作导航">
          <RouterLink
            class="nav-item"
            :class="{ active: currentMode === 'text-to-image' }"
            to="/generate/text-to-image"
            aria-label="文生图"
            @click="closeSidebar"
          >
            <Wand2 :size="19" />
            <span class="rail-tooltip" aria-hidden="true">文生图</span>
          </RouterLink>
          <RouterLink
            class="nav-item"
            :class="{ active: currentMode === 'image-to-image' }"
            to="/generate/image-to-image"
            aria-label="图生图"
            @click="closeSidebar"
          >
            <ImagePlus :size="19" />
            <span class="rail-tooltip" aria-hidden="true">图生图</span>
          </RouterLink>
          <RouterLink class="nav-item nav-item-spaced" to="/templates" aria-label="模板广场" @click="closeSidebar">
            <LayoutTemplate :size="19" />
            <span class="rail-tooltip" aria-hidden="true">模板广场</span>
          </RouterLink>
          <RouterLink class="nav-item" to="/history" aria-label="历史记录" @click="closeSidebar">
            <History :size="19" />
            <span class="rail-tooltip" aria-hidden="true">历史记录</span>
          </RouterLink>
        </nav>

        <div class="sidebar-footer">
          <template v-if="app.isAuthenticated">
            <button
              class="credit-balance-button"
              type="button"
              aria-label="积分记录"
              @click="showCreditLog = true"
            >
              <Coins :size="17" />
              <strong>{{ app.balance.balance }}</strong>
              <span class="rail-tooltip" aria-hidden="true">积分记录</span>
            </button>
            <button
              class="account-settings-button"
              type="button"
              aria-label="应用设置"
              @click="openSettings"
            >
              <Settings :size="17" />
              <span class="rail-tooltip" aria-hidden="true">应用设置</span>
            </button>
          </template>
          <button v-else class="sidebar-login-link" type="button" aria-label="登录" @click="showLogin = true">
            <LogIn :size="18" />
            <span class="rail-tooltip" aria-hidden="true">登录</span>
          </button>
        </div>
      </aside>

      <button v-if="sidebarOpen" class="sidebar-backdrop" aria-label="关闭导航" @click="closeSidebar" />

      <main class="content"><RouterView /></main>
    </div>

    <LoginModal v-if="showLogin" @close="showLogin = false" />
    <RechargeModal v-if="showRecharge" @close="showRecharge = false" />
    <CreditLogModal v-if="showCreditLog" @close="showCreditLog = false" @recharge="openRechargeFromCreditLog" />
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
  </div>
</template>
