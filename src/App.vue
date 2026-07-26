<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { RouterLink, RouterView, useRoute } from "vue-router";
import {
  Coins,
  CircleArrowUp,
  History,
  ImagePlus,
  LayoutTemplate,
  LogIn,
  Menu,
  QrCode,
  Scissors,
  Settings,
  Wand2
} from "lucide-vue-next";
import huanhuaMarkUrl from "@/assets/huanhua-mark.svg";
import LoginModal from "@/components/LoginModal.vue";
import QrcodeModal from "@/components/QrcodeModal.vue";
import RechargeModal from "@/components/RechargeModal.vue";
import CreditLogModal from "@/components/CreditLogModal.vue";
import SettingsModal from "@/components/SettingsModal.vue";
import UpdateModal from "@/components/UpdateModal.vue";
import WindowControls from "@/components/WindowControls.vue";
import { useAppUpdater } from "@/composables/useAppUpdater";
import { useAppStore } from "@/stores/app";

const app = useAppStore();
const {
  status: updateStatus,
  info: updateInfo,
  isAvailable: hasUpdate,
  isPromptVisible: showUpdate,
  canDismiss: canDismissUpdate,
  downloadedBytes: updateDownloadedBytes,
  totalBytes: updateTotalBytes,
  progressPercent: updateProgressPercent,
  errorMessage: updateErrorMessage,
  installed: updateInstalled,
  checkForUpdates,
  openPrompt: openUpdatePrompt,
  dismissPrompt: dismissUpdatePrompt,
  installAndRestart,
  retryRestart
} = useAppUpdater();
const route = useRoute();
const showLogin = shallowRef(false);
const showRecharge = shallowRef(false);
const showCreditLog = shallowRef(false);
const showSettings = shallowRef(false);
const showQrcode = shallowRef(false);
const sidebarOpen = shallowRef(false);
const formattedBalance = computed(() => new Intl.NumberFormat("zh-CN").format(app.balance.balance));

onMounted(() => {
  void app.init();
  void checkForUpdates();
  bindDevtoolsHotkey();
});

// 开发模式下用快捷键开关调试控制台：F12 或 Cmd/Ctrl+Shift+I
// 仅在 Tauri 运行时 + Vite DEV 下生效，release 包与浏览器预览均不触发
function bindDevtoolsHotkey() {
  if (!import.meta.env.DEV || !("__TAURI_INTERNALS__" in window)) return;
  const handler = async (event: KeyboardEvent) => {
    const toggle =
      event.key === "F12" ||
      ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "i");
    if (!toggle) return;
    event.preventDefault();
    try {
      await invoke("toggle-devtools");
    } catch (err) {
      console.error("[devtools] 打开失败，请查看 tauri dev 终端日志:", err);
    }
  };
  window.addEventListener("keydown", handler);
  onUnmounted(() => window.removeEventListener("keydown", handler));
}

const currentMode = computed(() => route.params.mode);

function closeSidebar() {
  sidebarOpen.value = false;
}

function openSettings() {
  showSettings.value = true;
  closeSidebar();
}

function openRechargeFromCreditLog() {
  showRecharge.value = true;
}
</script>

<template>
  <div class="app-shell">
    <header class="app-header" data-tauri-drag-region>
      <button class="mobile-menu" type="button" aria-label="打开导航" @click="sidebarOpen = true">
        <Menu :size="18" />
      </button>
      <div class="app-title" aria-label="幻画 AI">
        <img
          class="app-title-logo"
          :src="huanhuaMarkUrl"
          width="24"
          height="24"
          alt=""
          aria-hidden="true"
          draggable="false"
        />
        <strong>幻画 AI</strong>
      </div>
      <button
        v-if="app.isAuthenticated"
        class="header-credit-button"
        type="button"
        :aria-label="`积分余额 ${formattedBalance}，查看积分记录`"
        :title="`积分余额 ${formattedBalance}`"
        @click="showCreditLog = true"
      >
        <Coins :size="15" aria-hidden="true" />
        <span>积分</span>
        <strong>{{ formattedBalance }}</strong>
      </button>
      <WindowControls />
    </header>

    <div class="workspace" :class="{ 'sidebar-is-open': sidebarOpen }">
      <aside class="sidebar" aria-label="主导航">
        <nav class="main-nav" aria-label="创作导航">
          <RouterLink
            class="nav-item"
            :class="{ active: currentMode === 'text-to-image' }"
            to="/generate/text-to-image"
            aria-label="文生图"
            @click="closeSidebar"
          >
            <Wand2 :size="17" />
            <span class="rail-tooltip" aria-hidden="true">文生图</span>
          </RouterLink>
          <RouterLink
            class="nav-item"
            :class="{ active: currentMode === 'image-to-image' }"
            to="/generate/image-to-image"
            aria-label="图生图"
            @click="closeSidebar"
          >
            <ImagePlus :size="17" />
            <span class="rail-tooltip" aria-hidden="true">图生图</span>
          </RouterLink>
          <RouterLink class="nav-item" to="/cutout" aria-label="AI 抠图" @click="closeSidebar">
            <Scissors :size="17" />
            <span class="rail-tooltip" aria-hidden="true">AI 抠图</span>
          </RouterLink>
          <RouterLink class="nav-item nav-item-spaced" to="/templates" aria-label="模板广场" @click="closeSidebar">
            <LayoutTemplate :size="17" />
            <span class="rail-tooltip" aria-hidden="true">模板广场</span>
          </RouterLink>
          <RouterLink class="nav-item" to="/history" aria-label="历史记录" @click="closeSidebar">
            <History :size="17" />
            <span class="rail-tooltip" aria-hidden="true">历史记录</span>
          </RouterLink>
        </nav>

        <div class="sidebar-footer">
          <button
            v-if="hasUpdate && updateInfo"
            class="sidebar-update-button"
            type="button"
            :aria-label="`发现新版本 ${updateInfo.version}，查看更新`"
            :title="`发现新版本 ${updateInfo.version}`"
            @click="openUpdatePrompt"
          >
            <CircleArrowUp :size="18" aria-hidden="true" />
            <span class="rail-tooltip" aria-hidden="true">发现新版本 {{ updateInfo.version }}</span>
          </button>
          <button
            class="account-settings-button"
            type="button"
            aria-label="加入群聊"
            @click="showQrcode = true"
          >
            <QrCode :size="16" />
            <span class="rail-tooltip" aria-hidden="true">加入群聊</span>
          </button>
          <template v-if="app.isAuthenticated">
            <button
              class="account-settings-button"
              type="button"
              aria-label="应用设置"
              @click="openSettings"
            >
              <Settings :size="16" />
              <span class="rail-tooltip" aria-hidden="true">应用设置</span>
            </button>
          </template>
          <button v-else class="sidebar-login-link" type="button" aria-label="登录" @click="showLogin = true">
            <LogIn :size="16" />
            <span class="rail-tooltip" aria-hidden="true">登录</span>
          </button>
        </div>
      </aside>

      <button v-if="sidebarOpen" class="sidebar-backdrop" aria-label="关闭导航" @click="closeSidebar" />

      <main class="content"><RouterView /></main>
    </div>

    <QrcodeModal v-if="showQrcode" @close="showQrcode = false" />
    <LoginModal v-if="showLogin" @close="showLogin = false" />
    <CreditLogModal v-if="showCreditLog" @close="showCreditLog = false" @recharge="openRechargeFromCreditLog" />
    <RechargeModal v-if="showRecharge" @close="showRecharge = false" />
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    <UpdateModal
      v-if="showUpdate && updateInfo"
      :info="updateInfo"
      :status="updateStatus"
      :can-dismiss="canDismissUpdate"
      :downloaded-bytes="updateDownloadedBytes"
      :total-bytes="updateTotalBytes"
      :progress-percent="updateProgressPercent"
      :error-message="updateErrorMessage"
      :installed="updateInstalled"
      @dismiss="dismissUpdatePrompt"
      @install="installAndRestart"
      @restart="retryRestart"
    />
  </div>
</template>

<style scoped lang="scss">
.app-shell {
  height: 100vh;
  min-width: 0;
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr);
  overflow: hidden;
  background: var(--bg);
}

.app-header {
  position: relative;
  z-index: 20;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 12px;
  border-bottom: 1px solid var(--line);
  background: #0e141b;
}

.app-title {
  position: absolute;
  left: 50%;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  pointer-events: none;
  transform: translateX(-50%);
  user-select: none;

  &-logo {
    width: 24px;
    height: 24px;
    flex: 0 0 24px;
    display: block;
  }

  strong {
    font-size: 13px;
    font-weight: 680;
    letter-spacing: 0;
  }
}

.header-credit-button {
  position: relative;
  z-index: 1;
  min-width: 0;
  max-width: min(280px, calc(50vw - 84px));
  height: 34px;
  display: inline-grid;
  grid-template-columns: 16px auto minmax(0, auto);
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--warm);
  background: transparent;
  transition:
    border-color 0.18s ease,
    background 0.18s ease;

  &:hover,
  &:focus-visible {
    border-color: rgba(228, 160, 107, 0.58);
    background: rgba(228, 160, 107, 0.13);
  }

  span {
    color: var(--soft);
    font-size: 11px;
    font-weight: 600;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.workspace {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: 60px minmax(0, 1fr);
  overflow: hidden;
  border-color: var(--line);
}

.sidebar {
  position: relative;
  z-index: 12;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow: visible;
  color: var(--text);
  background: var(--sidebar);
  border-right: 1px solid var(--line);
}

.main-nav {
  width: 100%;
  min-height: 0;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 9px 0;
  overflow: visible;
}

.nav-item {
  position: relative;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--muted);
  text-decoration: none;
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;

  svg {
    flex: 0 0 auto;
  }

  &-spaced {
    margin-top: 14px;
  }

  &:hover {
    color: var(--text);
    border-color: var(--line-strong);
    background: var(--surface-subtle);
  }

  &.router-link-active,
  &.active {
    color: var(--accent-strong);
    border-color: var(--accent-border);
    background: var(--sidebar-soft);
  }
}

.sidebar-footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 8px;
}

.sidebar-update-button,
.account-settings-button,
.sidebar-login-link {
  position: relative;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--muted);
  background: var(--surface-subtle);
  transition:
    color 0.18s ease,
    border-color 0.18s ease,
    background 0.18s ease;

  &:hover {
    color: var(--accent-strong);
    border-color: var(--accent-border);
    background: var(--accent-soft);
  }
}

.sidebar-update-button {
  color: var(--success);
  border-color: rgba(101, 211, 173, 0.42);
  background: rgba(101, 211, 173, 0.11);

  &:hover {
    color: #9aebcf;
    border-color: rgba(101, 211, 173, 0.72);
    background: rgba(101, 211, 173, 0.17);
  }
}

.rail-tooltip {
  position: absolute;
  z-index: 50;
  top: 50%;
  left: calc(100% + 10px);
  min-width: max-content;
  padding: 7px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  color: var(--text);
  background: var(--surface-raised);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.38);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transform: translate(6px, -50%);
  transition:
    opacity 0.16s ease,
    transform 0.16s ease,
    visibility 0.16s ease;
}

.nav-item:hover .rail-tooltip,
.nav-item:focus-visible .rail-tooltip,
.sidebar-update-button:hover .rail-tooltip,
.sidebar-update-button:focus-visible .rail-tooltip,
.account-settings-button:hover .rail-tooltip,
.account-settings-button:focus-visible .rail-tooltip,
.sidebar-login-link:hover .rail-tooltip,
.sidebar-login-link:focus-visible .rail-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translate(0, -50%);
}

.content {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  background: var(--bg);
}

.mobile-menu,
.sidebar-backdrop {
  display: none;
}

@media (max-width: 900px) {
  .app-shell {
    min-height: 100vh;
    height: auto;
    grid-template-rows: 48px minmax(calc(100vh - 48px), auto);
  }

  .workspace {
    min-height: calc(100vh - 48px);
    display: block;
  }

  .sidebar {
    position: fixed;
    z-index: 30;
    top: 48px;
    bottom: 0;
    left: 0;
    width: 220px;
    align-items: stretch;
    padding: 16px 12px 12px;
    overflow: hidden;
    border-right: 1px solid var(--line);
    background: #0f151d;
    box-shadow: 16px 0 40px rgba(0, 0, 0, 0.36);
    transform: translateX(-100%);
    transition: transform 0.22s ease;
  }

  .sidebar-is-open .sidebar {
    transform: translateX(0);
  }

  .sidebar-backdrop {
    position: fixed;
    inset: 48px 0 0;
    z-index: 29;
    display: block;
    background: rgba(4, 7, 11, 0.72);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
  }

  .main-nav {
    align-items: stretch;
    padding: 0;
  }

  .nav-item,
  .sidebar-update-button,
  .account-settings-button,
  .sidebar-login-link {
    width: 100%;
    justify-content: flex-start;
    gap: 12px;
    padding: 0 14px;
  }

  .rail-tooltip {
    position: static;
    min-width: 0;
    padding: 0;
    border: 0;
    color: inherit;
    background: transparent;
    box-shadow: none;
    font-size: 12px;
    opacity: 1;
    visibility: visible;
    transform: none;
  }

  .sidebar-footer {
    align-items: stretch;
    padding: 12px 0 0;
  }

  .header-credit-button span {
    display: none;
  }

  .content {
    min-height: 100vh;
    overflow: visible;
  }

  .mobile-menu {
    position: absolute;
    left: 10px;
    width: 36px;
    height: 36px;
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
  }
}
</style>
