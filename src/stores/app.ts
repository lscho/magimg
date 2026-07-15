import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { defaultParams, defaultSettings } from "@/constants/defaults";
import { apiClient, setAccessToken } from "@/services/apiClient";
import { saveRemoteImage } from "@/services/desktop";
import { localDb } from "@/services/localStorage";
import type {
  AppSettings,
  CreditBalance,
  CreditPackage,
  CreditTransaction,
  GenerationMode,
  GenerationRecord,
  ImageParams,
  RechargeOrder,
  PromptTemplate,
  UserSession
} from "@/types";

export const useAppStore = defineStore("app", () => {
  const initialized = ref(false);
  const session = ref<UserSession | null>(null);
  const settings = ref<AppSettings>({ ...defaultSettings });
  const history = ref<GenerationRecord[]>([]);
  const balance = ref<CreditBalance>({ balance: 0, frozen: 0, updatedAt: new Date().toISOString() });
  const packages = ref<CreditPackage[]>([]);
  const transactions = ref<CreditTransaction[]>([]);
  const transactionsLoading = ref(false);
  const transactionsError = ref("");
  const activeMode = ref<GenerationMode>("text-to-image");
  const pendingTemplate = ref<PromptTemplate | null>(null);
  const generating = ref(false);
  const error = ref("");
  const lastOrder = ref<RechargeOrder | null>(null);

  const isAuthenticated = computed(() => Boolean(session.value));
  const visibleHistory = computed(() => [...history.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  async function init() {
    if (initialized.value) return;
    const [savedSettings, savedHistory, savedSession] = await Promise.all([
      localDb.readSettings(),
      localDb.readHistory(),
      localDb.readSession()
    ]);
    settings.value = {
      ...defaultSettings,
      ...savedSettings,
      defaultParams: {
        ...defaultParams,
        ...savedSettings.defaultParams,
        model: "gpt-image-2",
        outputCompression: Math.min(100, Math.max(1, savedSettings.defaultParams?.outputCompression ?? 85))
      }
    };
    history.value = Array.isArray(savedHistory) ? savedHistory : [];
    session.value = savedSession;
    setAccessToken(savedSession?.accessToken ?? null);
    initialized.value = true;
    await Promise.all([refreshBalance(), refreshPackages()]);
  }

  async function login(email: string, password: string, register = false) {
    error.value = "";
    const response = register ? await apiClient.register(email, password) : await apiClient.login(email, password);
    session.value = response.data;
    setAccessToken(response.data.accessToken);
    await localDb.writeSession(response.data);
    await refreshBalance();
  }

  async function logout() {
    await apiClient.logout();
    session.value = null;
    setAccessToken(null);
    await localDb.writeSession(null);
  }

  async function refreshBalance() {
    try {
      balance.value = (await apiClient.balance()).data;
    } catch (exception) {
      console.warn(exception);
    }
  }

  async function refreshPackages() {
    try {
      packages.value = (await apiClient.packages()).data;
    } catch (exception) {
      console.warn(exception);
    }
  }

  async function refreshTransactions() {
    transactionsLoading.value = true;
    transactionsError.value = "";
    try {
      transactions.value = (await apiClient.transactions()).data;
    } catch (exception) {
      transactionsError.value = exception instanceof Error ? exception.message : "积分记录加载失败。";
    } finally {
      transactionsLoading.value = false;
    }
  }

  async function saveSettings(nextSettings: AppSettings) {
    const normalized = {
      ...nextSettings,
      defaultParams: { ...nextSettings.defaultParams, model: "gpt-image-2" as const }
    };
    settings.value = normalized;
    await localDb.writeSettings(normalized);
  }

  async function addHistory(record: GenerationRecord) {
    history.value = [record, ...history.value].slice(0, 200);
    await localDb.writeHistory(history.value);
  }

  async function clearHistory() {
    history.value = [];
    await localDb.writeHistory([]);
  }

  async function generate(mode: GenerationMode, params: ImageParams) {
    if (!session.value) {
      throw new Error("请先登录后再生成图片。");
    }

    generating.value = true;
    error.value = "";
    try {
      const fixedParams: ImageParams = {
        ...params,
        model: "gpt-image-2",
        outputCompression: Math.min(100, Math.max(1, params.outputCompression))
      };
      const response =
        mode === "text-to-image"
          ? await apiClient.generateTextToImage(fixedParams)
          : await apiClient.generateImageToImage(fixedParams);
      const images = settings.value.autoSave
        ? await Promise.all(
            response.data.images.map(async (image, index) => ({
              ...image,
              localPath: await saveRemoteImage(
                image.remoteUrl,
                settings.value.saveDirectory,
                `${response.data.generationId}_${index + 1}.png`
              ).catch(() => undefined)
            }))
          )
        : response.data.images;

      const record: GenerationRecord = {
        id: `local_${Date.now()}`,
        generationId: response.data.generationId,
        mode,
        params: { ...fixedParams },
        images,
        status: response.data.status,
        costCredits: response.data.costCredits,
        balanceAfter: response.data.balanceAfter,
        createdAt: new Date().toISOString()
      };
      balance.value = { balance: response.data.balanceAfter, frozen: 0, updatedAt: new Date().toISOString() };
      await addHistory(record);
      void refreshTransactions();
      return record;
    } catch (exception) {
      error.value = exception instanceof Error ? exception.message : "生成失败，请稍后重试。";
      throw exception;
    } finally {
      generating.value = false;
    }
  }

  async function createRechargeOrder(packageId: string) {
    lastOrder.value = (await apiClient.createOrder(packageId)).data;
    return lastOrder.value;
  }

  function selectTemplate(template: PromptTemplate) {
    pendingTemplate.value = template;
  }

  function consumeTemplate(mode: GenerationMode) {
    if (pendingTemplate.value?.mode !== mode) return null;
    const template = pendingTemplate.value;
    pendingTemplate.value = null;
    return template;
  }

  return {
    initialized,
    session,
    settings,
    history,
    visibleHistory,
    balance,
    packages,
    transactions,
    transactionsLoading,
    transactionsError,
    activeMode,
    pendingTemplate,
    generating,
    error,
    lastOrder,
    isAuthenticated,
    init,
    login,
    logout,
    refreshBalance,
    refreshPackages,
    refreshTransactions,
    saveSettings,
    addHistory,
    clearHistory,
    generate,
    createRechargeOrder,
    selectTemplate,
    consumeTemplate
  };
});
