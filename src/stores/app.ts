import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { defaultParams, defaultSettings } from "@/constants/defaults";
import {
  ApiError,
  apiClient,
  isMockApi,
  resolveApiAssetUrl,
  setAccessToken,
  setApiBaseUrl,
  setUnauthorizedHandler
} from "@/services/apiClient";
import { saveRemoteImage } from "@/services/desktop";
import { localDb } from "@/services/localStorage";
import type {
  AppSettings,
  ClientAuthResponse,
  ClientGenerationMode,
  ClientUser,
  CreditBalance,
  CreditTransaction,
  CreditTransactionKind,
  GenerationMode,
  GenerationRecord,
  GenerationSettings,
  GenerationStatus,
  GenerationTask,
  ImageParams,
  PointLedgerEntry,
  PromptTemplate,
  SelectedImageFile,
  SupportedQuality,
  TemplateCategory,
  UserSession
} from "@/types";

const fallbackCapabilities: GenerationSettings = {
  textToImageCost: 10,
  imageToImageCost: 15,
  maxAttempts: 3,
  uploadMaxBytes: 5 * 1024 * 1024,
  supportedMimeTypes: ["image/jpeg", "image/png", "image/webp"],
  supportedQualities: ["auto", "low", "medium", "high"],
  sizeRules: {
    edgeStep: 16,
    maxEdge: 3840,
    maxAspectRatio: 3,
    minPixels: 655360,
    maxPixels: 8294400
  }
};

const pointKindMap: Record<PointLedgerEntry["type"], CreditTransactionKind> = {
  cardRedeem: "recharge",
  taskCharge: "generation",
  taskRefund: "refund",
  adminAdjustment: "adjustment"
};

const pointDescriptionMap: Record<PointLedgerEntry["type"], string> = {
  cardRedeem: "卡密充值",
  taskCharge: "图片生成",
  taskRefund: "生成退款",
  adminAdjustment: "余额调整"
};

function toClientMode(mode: GenerationMode): ClientGenerationMode {
  return mode === "image-to-image" ? "imageToImage" : "textToImage";
}

function toGenerationMode(mode: ClientGenerationMode): GenerationMode {
  return mode === "imageToImage" ? "image-to-image" : "text-to-image";
}

function toGenerationStatus(status: GenerationTask["status"]): GenerationStatus {
  return status === "pending" ? "queued" : status;
}

function toSession(response: ClientAuthResponse): UserSession {
  return {
    accessToken: response.token,
    expiresAt: response.expiresAt,
    user: {
      id: response.user.id,
      nickname: response.user.phone || response.user.username,
      phone: response.user.phone,
      email: response.user.email
    }
  };
}

function toCreditTransaction(entry: PointLedgerEntry): CreditTransaction {
  return {
    id: entry.id,
    kind: pointKindMap[entry.type],
    amount: entry.amount,
    balanceAfter: entry.balanceAfter,
    description: entry.note || pointDescriptionMap[entry.type],
    createdAt: entry.createdAt,
    referenceId: entry.referenceId
  };
}

function taskParams(task: GenerationTask): ImageParams {
  return {
    ...defaultParams,
    prompt: task.prompt,
    size: `${task.width}x${task.height}`,
    quality: task.quality,
    templateId: task.templateId
  };
}

function taskToRecord(task: GenerationTask, balanceAfter: number): GenerationRecord {
  const output = task.outputAsset;
  return {
    id: `server_${task.id}`,
    generationId: task.id,
    mode: toGenerationMode(task.mode),
    params: taskParams(task),
    images: output
      ? [
          {
            id: output.id,
            remoteUrl: resolveApiAssetUrl(output.url),
            width: task.width,
            height: task.height,
            mimeType: output.mimeType
          }
        ]
      : [],
    status: toGenerationStatus(task.status),
    costCredits: task.pointsCost,
    balanceAfter,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    errorMessage: task.errorMessage
  };
}

function extensionForMime(mimeType?: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

function parseSize(size: ImageParams["size"]) {
  if (size === "auto") return {};
  const match = /^(\d+)x(\d+)$/u.exec(size);
  if (!match) return {};
  return { width: Number(match[1]), height: Number(match[2]) };
}

function isSupportedQuality(quality: ImageParams["quality"]): quality is SupportedQuality {
  return quality === "auto" || quality === "low" || quality === "medium" || quality === "high";
}

const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

type GenerationErrorKind = "none" | "insufficientCredits" | "authentication" | "general";

function generationErrorDetails(exception: unknown): {
  kind: Exclude<GenerationErrorKind, "none">;
  message: string;
} {
  const message = exception instanceof Error ? exception.message.trim() : "";
  const isInsufficientCredits =
    /(?:积分|余额).*(?:不足|不够)|(?:不足|不够).*(?:积分|余额)/u.test(message);

  if ((exception instanceof ApiError && exception.statusCode === 409 && isInsufficientCredits) || isInsufficientCredits) {
    return {
      kind: "insufficientCredits",
      message: "积分不足，请充值后继续生成。"
    };
  }
  if (
    (exception instanceof ApiError && exception.statusCode === 401) ||
    /请先登录|登录已过期/u.test(message)
  ) {
    return {
      kind: "authentication",
      message: message || "请先登录或重新登录后再生成。"
    };
  }
  return {
    kind: "general",
    message: message || "生成失败，请稍后重试。"
  };
}

export const useAppStore = defineStore("app", () => {
  const initialized = shallowRef(false);
  const session = ref<UserSession | null>(null);
  const settings = ref<AppSettings>({ ...defaultSettings });
  const history = ref<GenerationRecord[]>([]);
  const serverHistory = ref<GenerationRecord[]>([]);
  const balance = ref<CreditBalance>({ balance: 0, frozen: 0, updatedAt: new Date().toISOString() });
  const transactions = ref<CreditTransaction[]>([]);
  const transactionsLoading = shallowRef(false);
  const transactionsError = shallowRef("");
  const capabilities = ref<GenerationSettings>({ ...fallbackCapabilities });
  const templates = ref<PromptTemplate[]>([]);
  const templateCategories = ref<TemplateCategory[]>([]);
  const templatesLoading = shallowRef(false);
  const templatesError = shallowRef("");
  const activeMode = shallowRef<GenerationMode>("text-to-image");
  const pendingTemplate = ref<PromptTemplate | null>(null);
  const generating = shallowRef(false);
  const currentTaskId = shallowRef<string | null>(null);
  const currentTaskStatus = shallowRef<GenerationTask["status"] | null>(null);
  const error = shallowRef("");
  const generationErrorKind = shallowRef<GenerationErrorKind>("none");

  const isAuthenticated = computed(() => Boolean(session.value));
  const visibleHistory = computed(() => {
    const records = new Map<string, GenerationRecord>();
    history.value.forEach((record) => records.set(record.generationId, record));
    serverHistory.value.forEach((record) => {
      if (!records.has(record.generationId)) records.set(record.generationId, record);
    });
    return [...records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  async function clearSession() {
    session.value = null;
    balance.value = { balance: 0, frozen: 0, updatedAt: new Date().toISOString() };
    transactions.value = [];
    serverHistory.value = [];
    setAccessToken(null);
    await localDb.writeSession(null);
  }

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
    setApiBaseUrl(settings.value.apiBaseUrl);
    setAccessToken(savedSession?.accessToken ?? null);
    setUnauthorizedHandler(clearSession);
    initialized.value = true;

    await Promise.all([refreshCapabilities(), refreshTemplates()]);
    if (session.value) {
      try {
        await refreshProfile();
        await Promise.all([refreshTransactions(), refreshTaskHistory()]);
      } catch (exception) {
        console.warn("恢复登录状态失败", exception);
      }
    }
  }

  async function sendSms(phone: string, purpose: "register" | "passwordReset") {
    return await apiClient.sendSms(phone.trim(), purpose);
  }

  async function login(phone: string, password: string) {
    error.value = "";
    generationErrorKind.value = "none";
    const response = await apiClient.login(phone.trim(), password, "幻画 AI 桌面端");
    session.value = toSession(response);
    setAccessToken(response.token);
    await localDb.writeSession(session.value);
    updateProfile(response.user);
    await Promise.all([refreshTransactions(), refreshTaskHistory()]);
  }

  async function register(phone: string, code: string, password: string) {
    error.value = "";
    generationErrorKind.value = "none";
    const response = await apiClient.register(phone.trim(), code.trim(), password, "幻画 AI 桌面端");
    session.value = toSession(response);
    setAccessToken(response.token);
    await localDb.writeSession(session.value);
    updateProfile(response.user);
    await Promise.all([refreshTransactions(), refreshTaskHistory()]);
  }

  async function resetPassword(phone: string, code: string, password: string) {
    await apiClient.resetPassword(phone.trim(), code.trim(), password);
  }

  async function logout() {
    try {
      await apiClient.logout();
    } finally {
      await clearSession();
    }
  }

  function updateProfile(user: ClientUser) {
    balance.value = { balance: user.points, frozen: 0, updatedAt: new Date().toISOString() };
    if (session.value) {
      session.value = {
        ...session.value,
        user: {
          ...session.value.user,
          id: user.id,
          nickname: user.phone || user.username,
          phone: user.phone,
          email: user.email
        }
      };
      void localDb.writeSession(session.value);
    }
  }

  async function refreshProfile() {
    if (!session.value) return;
    updateProfile(await apiClient.me());
  }

  async function refreshBalance() {
    try {
      await refreshProfile();
    } catch (exception) {
      console.warn("积分余额加载失败", exception);
    }
  }

  async function refreshCapabilities() {
    try {
      capabilities.value = await apiClient.capabilities();
    } catch (exception) {
      console.warn("平台能力加载失败，使用本地默认值", exception);
    }
  }

  async function refreshTemplates() {
    templatesLoading.value = true;
    templatesError.value = "";
    try {
      const [categoryResponse, firstPage] = await Promise.all([
        apiClient.templateCategories(),
        apiClient.templates({ page: 1, pageSize: 100 })
      ]);
      const allTemplates = [...firstPage.items];
      const pageCount = Math.ceil(firstPage.total / firstPage.pageSize);
      for (let page = 2; page <= pageCount; page += 1) {
        const response = await apiClient.templates({ page, pageSize: 100 });
        allTemplates.push(...response.items);
      }

      templateCategories.value = categoryResponse.items;
      const categoryNames = new Map(categoryResponse.items.map((category) => [category.id, category.name]));
      templates.value = allTemplates.map((template) => ({
        id: template.id,
        templateId: template.id,
        mode: toGenerationMode(template.mode),
        title: template.name,
        category: template.categoryName || categoryNames.get(template.categoryId) || "其他",
        description: template.description || "",
        prompt: template.prompt,
        tags: [],
        previewImage: resolveApiAssetUrl(template.effectImage),
        sourceImage:
          template.sourceImage && template.sourceImage !== template.effectImage
            ? resolveApiAssetUrl(template.sourceImage)
            : undefined,
        width: template.width,
        height: template.height,
        quality: template.quality
      }));
    } catch (exception) {
      templatesError.value = exception instanceof Error ? exception.message : "模板加载失败。";
    } finally {
      templatesLoading.value = false;
    }
  }

  async function refreshTransactions() {
    if (!session.value) return;
    transactionsLoading.value = true;
    transactionsError.value = "";
    try {
      const response = await apiClient.points(1, 50);
      transactions.value = response.items.map(toCreditTransaction);
    } catch (exception) {
      transactionsError.value = exception instanceof Error ? exception.message : "积分记录加载失败。";
    } finally {
      transactionsLoading.value = false;
    }
  }

  async function refreshTaskHistory() {
    if (!session.value) return;
    try {
      const firstPage = await apiClient.tasks({ page: 1, pageSize: 100 });
      const allTasks = [...firstPage.items];
      const pageCount = Math.min(2, Math.ceil(firstPage.total / firstPage.pageSize));
      for (let page = 2; page <= pageCount; page += 1) {
        const response = await apiClient.tasks({ page, pageSize: 100 });
        allTasks.push(...response.items);
      }
      serverHistory.value = allTasks.map((task) => taskToRecord(task, balance.value.balance));
    } catch (exception) {
      console.warn("服务端任务历史加载失败", exception);
    }
  }

  async function saveSettings(nextSettings: AppSettings) {
    const normalizedApiBaseUrl = nextSettings.apiBaseUrl.trim().replace(/\/+$/u, "");
    const apiBaseChanged = normalizedApiBaseUrl !== settings.value.apiBaseUrl;
    const normalized = {
      ...nextSettings,
      apiBaseUrl: normalizedApiBaseUrl,
      defaultParams: { ...nextSettings.defaultParams, model: "gpt-image-2" as const }
    };
    settings.value = normalized;
    setApiBaseUrl(normalized.apiBaseUrl);
    await localDb.writeSettings(normalized);
    if (apiBaseChanged && !isMockApi) {
      await clearSession();
      await Promise.all([refreshCapabilities(), refreshTemplates()]);
    }
  }

  async function addHistory(record: GenerationRecord) {
    history.value = [record, ...history.value.filter((item) => item.generationId !== record.generationId)].slice(0, 200);
    await localDb.writeHistory(history.value);
  }

  async function clearHistory() {
    history.value = [];
    await localDb.writeHistory([]);
  }

  async function generate(
    mode: GenerationMode,
    params: ImageParams,
    referenceImage: SelectedImageFile | null = null
  ) {
    generating.value = true;
    error.value = "";
    generationErrorKind.value = "none";
    currentTaskId.value = null;
    currentTaskStatus.value = null;
    try {
      if (!session.value) throw new Error("请先登录后再生成图片。");

      const fixedParams: ImageParams = {
        ...params,
        model: "gpt-image-2",
        n: 1,
        background: "auto",
        outputCompression: Math.min(100, Math.max(1, params.outputCompression))
      };

      let inputAssetId: string | undefined;
      if (mode === "image-to-image") {
        if (!referenceImage) throw new Error("请先选择参考图片。");
        if (!capabilities.value.supportedMimeTypes.includes(referenceImage.file.type)) {
          throw new Error("仅支持 JPEG、PNG 和 WebP 图片。");
        }
        if (referenceImage.file.size > capabilities.value.uploadMaxBytes) {
          throw new Error(`参考图片不能超过 ${Math.floor(capabilities.value.uploadMaxBytes / 1024 / 1024)} MB。`);
        }
        inputAssetId = (await apiClient.uploadImage(referenceImage.file)).id;
      }

      const prompt = fixedParams.prompt.trim();
      if (prompt.length < 1 || prompt.length > 4000) {
        throw new Error("提示词须为 1 到 4000 个字符。");
      }
      const taskInput = {
        mode: toClientMode(mode),
        prompt,
        ...(fixedParams.templateId ? { templateId: fixedParams.templateId } : {}),
        ...(inputAssetId ? { inputAssetId } : {}),
        ...parseSize(fixedParams.size),
        quality:
          isSupportedQuality(fixedParams.quality) &&
          capabilities.value.supportedQualities.includes(fixedParams.quality)
            ? fixedParams.quality
            : capabilities.value.supportedQualities[0] || "auto"
      };
      let task = await apiClient.createTask(taskInput);
      currentTaskId.value = task.id;
      currentTaskStatus.value = task.status;
      await refreshProfile();

      for (let attempt = 0; task.status === "pending" || task.status === "processing"; attempt += 1) {
        if (attempt >= 150) throw new Error("生成任务等待超时，请稍后在历史记录中查看。");
        await wait(2000);
        task = await apiClient.task(task.id);
        currentTaskStatus.value = task.status;
      }

      if (task.status === "cancelled") throw new Error("生成任务已取消，积分已退回。");
      if (task.status !== "succeeded" || !task.outputAsset) {
        throw new Error(task.errorMessage || "生成失败，积分已退回。");
      }

      const record = taskToRecord(task, balance.value.balance);
      const images = settings.value.autoSave
        ? await Promise.all(
            record.images.map(async (image, index) => ({
              ...image,
              localPath: await saveRemoteImage(
                image.remoteUrl,
                settings.value.saveDirectory,
                `${task.id}_${index + 1}.${extensionForMime(image.mimeType)}`
              ).catch(() => undefined)
            }))
          )
        : record.images;
      const completedRecord = { ...record, params: fixedParams, images };

      await addHistory(completedRecord);
      await Promise.all([refreshProfile(), refreshTransactions(), refreshTaskHistory()]);
      return completedRecord;
    } catch (exception) {
      const details = generationErrorDetails(exception);
      error.value = details.message;
      generationErrorKind.value = details.kind;
      void refreshProfile();
      void refreshTransactions();
      throw exception;
    } finally {
      generating.value = false;
      currentTaskId.value = null;
      currentTaskStatus.value = null;
    }
  }

  async function cancelCurrentGeneration() {
    if (!currentTaskId.value || currentTaskStatus.value !== "pending") return;
    try {
      const task = await apiClient.cancelTask(currentTaskId.value);
      currentTaskStatus.value = task.status;
      await Promise.all([refreshProfile(), refreshTransactions(), refreshTaskHistory()]);
    } catch (exception) {
      error.value = exception instanceof Error ? exception.message : "取消任务失败。";
      throw exception;
    }
  }

  async function redeemCard(code: string) {
    const result = await apiClient.redeemCard(code.trim());
    balance.value = { balance: result.balance, frozen: 0, updatedAt: new Date().toISOString() };
    if (generationErrorKind.value === "insufficientCredits") {
      error.value = "";
      generationErrorKind.value = "none";
    }
    await refreshTransactions();
    return result;
  }

  function clearGenerationError() {
    error.value = "";
    generationErrorKind.value = "none";
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
    transactions,
    transactionsLoading,
    transactionsError,
    capabilities,
    templates,
    templateCategories,
    templatesLoading,
    templatesError,
    activeMode,
    pendingTemplate,
    generating,
    currentTaskStatus,
    error,
    generationErrorKind,
    isAuthenticated,
    init,
    sendSms,
    login,
    register,
    resetPassword,
    logout,
    refreshBalance,
    refreshCapabilities,
    refreshTemplates,
    refreshTransactions,
    refreshTaskHistory,
    saveSettings,
    addHistory,
    clearHistory,
    generate,
    cancelCurrentGeneration,
    clearGenerationError,
    redeemCard,
    selectTemplate,
    consumeTemplate
  };
});
