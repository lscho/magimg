<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import {
  ArrowRight,
  History,
  ImagePlus,
  LayoutTemplate,
  LogOut,
  Menu,
  Plus,
  Settings,
  Sparkles,
  UserRound,
  Wand2
} from "lucide-vue-next";
import LoginModal from "@/components/LoginModal.vue";
import RechargeModal from "@/components/RechargeModal.vue";
import CreditLogModal from "@/components/CreditLogModal.vue";
import SettingsModal from "@/components/SettingsModal.vue";
import { useAppStore } from "@/stores/app";

const app = useAppStore();
const route = useRoute();
const showLogin = ref(false);
const showRecharge = ref(false);
const showCreditLog = ref(false);
const showSettings = ref(false);
const sidebarOpen = ref(false);

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
</script>

<template>
  <div class="app-shell">
    <div class="workspace" :class="{ 'sidebar-is-open': sidebarOpen }">
      <aside class="sidebar">
        <div class="brand brand-compact">
          <div class="brand-mark">
            <Sparkles :size="22" />
          </div>
          <div>
            <strong>幻画 AI</strong>
            <span>创意图像工作台</span>
          </div>
        </div>

        <nav class="main-nav">
          <span class="nav-label">创作</span>
          <RouterLink
            class="nav-item"
            :class="{ active: currentMode === 'text-to-image' }"
            to="/generate/text-to-image"
            @click="closeSidebar"
          >
            <Wand2 :size="19" />
            文生图
          </RouterLink>
          <RouterLink
            class="nav-item"
            :class="{ active: currentMode === 'image-to-image' }"
            to="/generate/image-to-image"
            @click="closeSidebar"
          >
            <ImagePlus :size="19" />
            图生图
          </RouterLink>
          <span class="nav-label nav-label-spaced">工作区</span>
          <RouterLink class="nav-item" to="/templates" @click="closeSidebar">
            <LayoutTemplate :size="19" />
            模板广场
          </RouterLink>
          <RouterLink class="nav-item" to="/history" @click="closeSidebar">
            <History :size="19" />
            历史记录
          </RouterLink>
        </nav>

        <div class="sidebar-footer">
          <section class="credit-panel" :class="{ unauthenticated: !app.isAuthenticated }">
            <button
              class="account-settings-button"
              type="button"
              title="应用设置"
              aria-label="应用设置"
              @click="openSettings"
            >
              <Settings :size="17" />
            </button>
            <template v-if="app.isAuthenticated">
              <button class="credit-balance-button" type="button" @click="showCreditLog = true">
                <strong>{{ app.balance.balance }}</strong>
                <span>积分</span>
              </button>
              <button class="credit-action" type="button" title="获取积分" aria-label="获取积分" @click="showRecharge = true">
                <Plus :size="16" />
              </button>
              <button class="credit-logout" type="button" title="退出登录" aria-label="退出登录" @click="app.logout">
                <LogOut :size="15" />
              </button>
            </template>
            <button v-else class="sidebar-login-link" type="button" @click="showLogin = true">
              <UserRound :size="17" />
              <span>登录</span>
              <ArrowRight :size="15" />
            </button>
          </section>
        </div>
      </aside>

      <button v-if="sidebarOpen" class="sidebar-backdrop" aria-label="关闭导航" @click="closeSidebar" />

      <main class="content">
        <div class="mobile-toolbar">
          <button class="mobile-menu" aria-label="打开导航" @click="sidebarOpen = true">
            <Menu :size="20" />
          </button>
        </div>
        <RouterView />
      </main>
    </div>

    <LoginModal v-if="showLogin" @close="showLogin = false" />
    <RechargeModal v-if="showRecharge" @close="showRecharge = false" />
    <CreditLogModal v-if="showCreditLog" @close="showCreditLog = false" />
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
  </div>
</template>
