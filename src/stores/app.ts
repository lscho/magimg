import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import { defaultParams, defaultSettings } from "@/constants/defaults";
import {
  ApiError,
  apiClient,
  resolveApiAssetUrl,
  setAccessToken,
  setApiBaseUrl,
  setUnauthorizedHandler
} from "@/services/apiClient";
import { saveRemoteImage } from "@/services/desktop";
import {
  createCutoutHistoryRecord,
  loadCutoutHistoryAsset as readCutoutHistoryAsset,
  loadCutoutHistoryAssets as readCutoutHistoryAssets,
  loadCutoutHistoryWorkspace as readCutoutHistoryWorkspace,
  readCutoutHistoryRecords,
  removeCutoutHistoryRecords,
  type CreateCutoutHistoryInput
} from "@/services/cutoutHistoryStorage";
import { localDb } from "@/services/localStorage";
import type {
  AppSettings,
  ClientAuthResponse,
  ClientGenerationMode,
  ClientUser,
  CreditBalance,
  CreditTransaction,
  CreditTransactionKind,
  CutoutHistoryAsset,
  CutoutHistoryRecord,
  GenerationMode,
  GenerationRecord,
  GenerationSettings,
  GenerationStatus,
  GenerationTask,
  GeneratedImage,
  ImageParams,
  MattingChargeResult,
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
  mattingCost: 5,
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
  mattingCharge: "generation",
  mattingRefund: "refund",
  adminAdjustment: "adjustment"
};

const pointDescriptionMap: Record<PointLedgerEntry["type"], string> = {
  cardRedeem: "卡密充值",
  taskCharge: "图片生成",
  taskRefund: "生成退款",
  mattingCharge: "AI 抠图",
  mattingRefund: "抠图退款",
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

function isGenerationInProgress(record: GenerationRecord | null) {
  return record?.status === "queued" || record?.status === "processing";
}

function toTaskStatus(status?: GenerationStatus): GenerationTask["status"] | null {
  if (!status) return null;
  return status === "queued" ? "pending" : status;
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

function isPersistedSession(value: unknown): value is UserSession {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<UserSession>;
  if (typeof candidate.accessToken !== "string" || !candidate.accessToken.trim()) return false;
  if (!candidate.user || typeof candidate.user !== "object") return false;
  if (typeof candidate.user.id !== "string" || !candidate.user.id) return false;
  if (typeof candidate.user.nickname !== "string") return false;

  if (candidate.expiresAt !== undefined) {
    if (typeof candidate.expiresAt !== "string") return false;
    const expiresAt = Date.parse(candidate.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  }

  return true;
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
  const input = task.inputAsset;
  const output = task.outputAsset;
  return {
    id: `server_${task.id}`,
    generationId: task.id,
    mode: toGenerationMode(task.mode),
    params: taskParams(task),
    inputImage: input
      ? {
          id: input.id,
          remoteUrl: resolveApiAssetUrl(input.url),
          width: task.width,
          height: task.height,
          mimeType: input.mimeType
        }
      : undefined,
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

// 以服务端图片为准，按 asset id 合并本地的 localPath（仅同一资源才保留下载副本路径）。
function mergeServerImage(serverImage: GeneratedImage, localImages: GeneratedImage[]): GeneratedImage {
  const localMatch = localImages.find((local) => local.id === serverImage.id);
  return localMatch?.localPath ? { ...serverImage, localPath: localMatch.localPath } : serverImage;
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
  const hiddenHistoryIds = ref<string[]>([]);
  const cutoutHistory = ref<CutoutHistoryRecord[]>([]);
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
  const pendingHistoryWorkspace = shallowRef<{
    record: GenerationRecord;
    referenceImage: SelectedImageFile | null;
  } | null>(null);
  const pendingReferenceImage = shallowRef<SelectedImageFile | null>(null);
  const creatingGeneration = shallowRef(false);
  const activeGeneration = ref<GenerationRecord | null>(null);
  const error = shallowRef("");
  const generationErrorKind = shallowRef<GenerationErrorKind>("none");
  let generationMonitorVersion = 0;
  let monitoredTaskId: string | null = null;
  let monitoredTaskPromise: Promise<GenerationRecord> | null = null;
  let hydrationPromise: Promise<void> | null = null;
  let initializationPromise: Promise<void> | null = null;

  const isAuthenticated = computed(() => Boolean(session.value));
  const generating = computed(
    () => creatingGeneration.value || isGenerationInProgress(activeGeneration.value)
  );
  const currentTaskStatus = computed(() => toTaskStatus(activeGeneration.value?.status));
  const recoverableGeneration = computed(() =>
    isGenerationInProgress(activeGeneration.value) ? activeGeneration.value : null
  );
  const visibleHistory = computed(() => {
    const records = new Map<string, GenerationRecord>();
    const hiddenIds = new Set(hiddenHistoryIds.value);
    history.value.forEach((record) => records.set(record.generationId, record));
    serverHistory.value.forEach((record) => {
      const localRecord = records.get(record.generationId);
      if (!localRecord) {
        records.set(record.generationId, record);
      } else {
        // 本地与服务端同时存在：图片相关字段以服务端为准，按 asset id 保留本地 localPath；其余字段维持本地。
        records.set(record.generationId, {
          ...localRecord,
          images: record.images.map((image) => mergeServerImage(image, localRecord.images)),
          inputImage: record.inputImage
            ? mergeServerImage(record.inputImage, localRecord.inputImage ? [localRecord.inputImage] : [])
            : localRecord.inputImage
        });
      }
    });
    return [...records.values()]
      .filter((record) => !hiddenIds.has(record.generationId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  async function clearSession() {
    stopGenerationMonitor();
    creatingGeneration.value = false;
    activeGeneration.value = null;
    session.value = null;
    balance.value = { balance: 0, frozen: 0, updatedAt: new Date().toISOString() };
    transactions.value = [];
    serverHistory.value = [];
    pendingHistoryWorkspace.value = null;
    pendingReferenceImage.value = null;
    setAccessToken(null);
    await localDb.writeSession(null);
  }

  async function hydrateLocalState() {
    if (initialized.value) return;
    hydrationPromise ??= (async () => {
      const [
        savedSettings,
        savedHistory,
        savedHiddenHistoryIds,
        savedCutoutHistory,
        savedSession
      ] = await Promise.all([
        localDb.readSettings(),
        localDb.readHistory(),
        localDb.readHiddenHistoryIds(),
        readCutoutHistoryRecords(),
        localDb.readSession()
      ]);
      const savedApiBaseUrl = savedSettings.apiBaseUrl?.trim().replace(/\/+$/u, "");
      const apiBaseUrl =
        !savedApiBaseUrl || savedApiBaseUrl === "https://api.example.com"
          ? defaultSettings.apiBaseUrl
          : savedApiBaseUrl;
      const restoredSession = isPersistedSession(savedSession) ? savedSession : null;

      settings.value = {
        ...defaultSettings,
        ...savedSettings,
        apiBaseUrl,
        defaultParams: {
          ...defaultParams,
          ...savedSettings.defaultParams,
          model: "gpt-image-2",
          outputCompression: Math.min(100, Math.max(0, savedSettings.defaultParams?.outputCompression ?? 85))
        }
      };
      history.value = Array.isArray(savedHistory) ? savedHistory : [];
      hiddenHistoryIds.value = Array.isArray(savedHiddenHistoryIds) ? savedHiddenHistoryIds : [];
      cutoutHistory.value = savedCutoutHistory;
      session.value = restoredSession;
      setApiBaseUrl(settings.value.apiBaseUrl);
      setAccessToken(restoredSession?.accessToken ?? null);
      setUnauthorizedHandler(clearSession);
      initialized.value = true;

      if (savedSession !== null && !restoredSession) {
        try {
          await localDb.writeSession(null);
        } catch (exception) {
          console.warn("清理无效登录缓存失败", exception);
        }
      }
    })();
    await hydrationPromise;
  }

  async function init() {
    await hydrateLocalState();
    initializationPromise ??= (async () => {
      await Promise.all([refreshCapabilities(), refreshTemplates()]);
      if (session.value) {
        try {
          await refreshProfile();
          await Promise.all([refreshTransactions(), refreshTaskHistory()]);
        } catch (exception) {
          console.warn("恢复登录状态失败", exception);
        }
      }
    })();
    await initializationPromise;
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
      const latestInProgressTask = allTasks.find(
        (task) => task.status === "pending" || task.status === "processing"
      );
      if (latestInProgressTask) {
        const recoveredRecord = setActiveGeneration(latestInProgressTask);
        void monitorGenerationTask(latestInProgressTask.id, recoveredRecord.params).catch((exception) => {
          if (activeGeneration.value?.generationId === latestInProgressTask.id) {
            activeGeneration.value = null;
          }
          console.warn("进行中任务恢复失败", exception);
        });
      }
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
    if (apiBaseChanged) {
      await clearSession();
      await Promise.all([refreshCapabilities(), refreshTemplates()]);
    }
  }

  async function addHistory(record: GenerationRecord) {
    history.value = [record, ...history.value.filter((item) => item.generationId !== record.generationId)].slice(0, 200);
    if (hiddenHistoryIds.value.includes(record.generationId)) {
      hiddenHistoryIds.value = hiddenHistoryIds.value.filter((id) => id !== record.generationId);
      await localDb.writeHiddenHistoryIds(hiddenHistoryIds.value);
    }
    await localDb.writeHistory(history.value);
  }

  function upsertServerHistory(record: GenerationRecord) {
    serverHistory.value = [
      record,
      ...serverHistory.value.filter((item) => item.generationId !== record.generationId)
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  function stopGenerationMonitor() {
    generationMonitorVersion += 1;
    monitoredTaskId = null;
    monitoredTaskPromise = null;
  }

  function setActiveGeneration(task: GenerationTask, params?: ImageParams) {
    const existingParams =
      activeGeneration.value?.generationId === task.id ? activeGeneration.value.params : undefined;
    const resolvedParams = params ?? existingParams ?? taskParams(task);
    const record: GenerationRecord = {
      ...taskToRecord(task, balance.value.balance),
      params: {
        ...resolvedParams,
        prompt: task.prompt,
        size: `${task.width}x${task.height}` as ImageParams["size"],
        quality: task.quality,
        templateId: task.templateId
      }
    };
    activeGeneration.value = record;
    upsertServerHistory(record);
    return record;
  }

  async function finalizeGenerationTask(task: GenerationTask, params?: ImageParams) {
    let record = setActiveGeneration(task, params);
    if (task.status === "succeeded" && task.outputAsset) {
      const savedRecord = history.value.find(
        (item) => item.generationId === task.id && item.status === "succeeded"
      );
      if (savedRecord) {
        record = { ...record, images: savedRecord.images };
      } else if (settings.value.autoSave) {
        record = {
          ...record,
          images: await Promise.all(
            record.images.map(async (image, index) => ({
              ...image,
              localPath: await saveRemoteImage(
                image.remoteUrl,
                settings.value.saveDirectory,
                `${task.id}_${index + 1}.${extensionForMime(image.mimeType)}`
              ).catch(() => undefined)
            }))
          )
        };
      }
      activeGeneration.value = record;
      upsertServerHistory(record);
      await addHistory(record);
    }
    await Promise.allSettled([refreshProfile(), refreshTransactions()]);
    return record;
  }

  async function runGenerationMonitor(
    taskId: string,
    params: ImageParams,
    monitorVersion: number
  ): Promise<GenerationRecord> {
    while (monitorVersion === generationMonitorVersion) {
      const current = activeGeneration.value;
      if (current?.generationId === taskId && !isGenerationInProgress(current)) return current;
      if (!session.value) throw new Error("登录已过期，请重新登录。");

      await wait(2000);
      if (monitorVersion !== generationMonitorVersion) throw new Error("任务监控已停止。");

      let task: GenerationTask;
      try {
        task = await apiClient.task(taskId);
      } catch (exception) {
        const isFatalApiError =
          exception instanceof ApiError &&
          (exception.statusCode === 401 || exception.statusCode === 404);
        if (isFatalApiError || !session.value) {
          if (activeGeneration.value?.generationId === taskId) activeGeneration.value = null;
          throw exception;
        }
        console.warn("生成任务状态查询失败，将继续重试", exception);
        continue;
      }

      const record = setActiveGeneration(task, params);
      if (!isGenerationInProgress(record)) {
        return await finalizeGenerationTask(task, params);
      }
    }
    throw new Error("任务监控已停止。");
  }

  function monitorGenerationTask(taskId: string, params: ImageParams) {
    if (monitoredTaskId === taskId && monitoredTaskPromise) return monitoredTaskPromise;

    const monitorVersion = ++generationMonitorVersion;
    monitoredTaskId = taskId;
    const taskPromise = runGenerationMonitor(taskId, params, monitorVersion);
    monitoredTaskPromise = taskPromise;
    void taskPromise
      .finally(() => {
        if (generationMonitorVersion === monitorVersion) {
          monitoredTaskId = null;
          monitoredTaskPromise = null;
        }
      })
      .catch(() => undefined);
    return taskPromise;
  }

  async function removeHistory(generationIds: string[]) {
    const ids = new Set(generationIds);
    if (!ids.size) return;

    history.value = history.value.filter((record) => !ids.has(record.generationId));
    serverHistory.value = serverHistory.value.filter((record) => !ids.has(record.generationId));
    hiddenHistoryIds.value = [...new Set([...hiddenHistoryIds.value, ...ids])].slice(-1000);
    await Promise.all([
      localDb.writeHistory(history.value),
      localDb.writeHiddenHistoryIds(hiddenHistoryIds.value)
    ]);
  }

  async function clearHistory() {
    await removeHistory(visibleHistory.value.map((record) => record.generationId));
  }

  async function addCutoutHistory(input: CreateCutoutHistoryInput) {
    cutoutHistory.value = await createCutoutHistoryRecord(input, cutoutHistory.value);
  }

  async function removeCutoutHistory(taskIds: string[]) {
    if (!taskIds.length) return;
    cutoutHistory.value = await removeCutoutHistoryRecords(taskIds, cutoutHistory.value);
  }

  async function loadCutoutAsset(record: CutoutHistoryRecord, asset: CutoutHistoryAsset) {
    return readCutoutHistoryAsset(record, asset);
  }

  async function loadCutoutAssets(records: CutoutHistoryRecord[]) {
    return readCutoutHistoryAssets(records);
  }

  async function restoreCutoutWorkspace(record: CutoutHistoryRecord) {
    return readCutoutHistoryWorkspace(record);
  }

  async function generate(
    mode: GenerationMode,
    params: ImageParams,
    referenceImage: SelectedImageFile | null = null
  ) {
    error.value = "";
    generationErrorKind.value = "none";
    try {
      if (!session.value) throw new Error("请先登录后再生成图片。");
      if (generating.value) throw new Error("已有任务正在生成，请先恢复当前任务。");

      stopGenerationMonitor();
      activeGeneration.value = null;
      creatingGeneration.value = true;

      const fixedParams: ImageParams = {
        ...params,
        model: "gpt-image-2",
        n: 1,
        background: "auto",
        outputCompression: Math.min(100, Math.max(0, params.outputCompression))
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
            : capabilities.value.supportedQualities[0] || "auto",
        outputFormat: fixedParams.outputFormat,
        ...(fixedParams.outputFormat !== "png"
          ? { outputCompression: fixedParams.outputCompression }
          : {})
      };
      const task = await apiClient.createTask(taskInput);
      const activeRecord = setActiveGeneration(task, fixedParams);
      creatingGeneration.value = false;
      await Promise.allSettled([refreshProfile()]);

      const completedRecord = isGenerationInProgress(activeRecord)
        ? await monitorGenerationTask(task.id, fixedParams)
        : await finalizeGenerationTask(task, fixedParams);
      if (completedRecord.status === "cancelled") {
        throw new Error("生成任务已取消，积分已退回。");
      }
      if (completedRecord.status !== "succeeded" || !completedRecord.images.length) {
        throw new Error(completedRecord.errorMessage || "生成失败，积分已退回。");
      }
      return completedRecord;
    } catch (exception) {
      const details = generationErrorDetails(exception);
      error.value = details.message;
      generationErrorKind.value = details.kind;
      void refreshProfile();
      void refreshTransactions();
      throw exception;
    } finally {
      creatingGeneration.value = false;
    }
  }

  async function cancelCurrentGeneration() {
    const current = activeGeneration.value;
    if (!current || current.status !== "queued") return;
    try {
      const task = await apiClient.cancelTask(current.generationId);
      setActiveGeneration(task, current.params);
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

  async function chargeMatting(): Promise<MattingChargeResult> {
    if (!session.value) throw new Error("请先登录后再使用 AI 抠图。");
    const result = await apiClient.chargeMatting();
    balance.value = { balance: result.balance, frozen: 0, updatedAt: new Date().toISOString() };
    return result;
  }

  async function refundMatting(mattingId: string): Promise<void> {
    if (!session.value || !mattingId) return;
    const result = await apiClient.refundMatting(mattingId);
    balance.value = { balance: result.balance, frozen: 0, updatedAt: new Date().toISOString() };
    void refreshTransactions();
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

  async function resolveHistoryTask(record: GenerationRecord) {
    if (record.mode !== "image-to-image" || record.inputImage || !session.value) return record;

    const task = await apiClient.task(record.generationId);
    const serverRecord = taskToRecord(task, balance.value.balance);
    upsertServerHistory(serverRecord);
    return {
      ...record,
      inputImage: serverRecord.inputImage,
      images: record.images.length ? record.images : serverRecord.images
    };
  }

  function queueHistoryWorkspace(
    record: GenerationRecord,
    referenceImage: SelectedImageFile | null
  ) {
    pendingReferenceImage.value = null;
    pendingHistoryWorkspace.value = {
      record,
      referenceImage
    };
  }

  function consumeHistoryWorkspace(mode: GenerationMode) {
    if (pendingHistoryWorkspace.value?.record.mode !== mode) return null;
    const workspace = pendingHistoryWorkspace.value;
    pendingHistoryWorkspace.value = null;
    return workspace;
  }

  function discardHistoryWorkspace() {
    pendingHistoryWorkspace.value = null;
  }

  function queueReferenceImage(referenceImage: SelectedImageFile) {
    pendingHistoryWorkspace.value = null;
    pendingReferenceImage.value = referenceImage;
  }

  function consumeReferenceImage(mode: GenerationMode) {
    if (mode !== "image-to-image") return null;
    const referenceImage = pendingReferenceImage.value;
    pendingReferenceImage.value = null;
    return referenceImage;
  }

  function discardReferenceImage() {
    pendingReferenceImage.value = null;
  }

  return {
    initialized,
    session,
    settings,
    history,
    visibleHistory,
    cutoutHistory,
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
    creatingGeneration,
    activeGeneration,
    recoverableGeneration,
    generating,
    currentTaskStatus,
    error,
    generationErrorKind,
    isAuthenticated,
    hydrateLocalState,
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
    removeHistory,
    clearHistory,
    addCutoutHistory,
    removeCutoutHistory,
    loadCutoutAsset,
    loadCutoutAssets,
    restoreCutoutWorkspace,
    generate,
    cancelCurrentGeneration,
    clearGenerationError,
    redeemCard,
    chargeMatting,
    refundMatting,
    selectTemplate,
    consumeTemplate,
    resolveHistoryTask,
    queueHistoryWorkspace,
    consumeHistoryWorkspace,
    discardHistoryWorkspace,
    queueReferenceImage,
    consumeReferenceImage,
    discardReferenceImage
  };
});
