import { sampleImages } from "@/constants/defaults";
import { promptTemplates } from "@/constants/promptTemplates";
import type {
  CardRedeemResult,
  ClientAsset,
  ClientAuthResponse,
  ClientGenerationMode,
  ClientPagination,
  ClientUser,
  CreateGenerationTaskInput,
  GenerationSettings,
  GenerationTask,
  GenerationTaskStatus,
  GenerationTemplate,
  OutputFormat,
  PointLedgerEntry,
  TemplateCategory
} from "@/types";

let mockBalance = 1200;
const now = Date.now();
const mockTransactions: PointLedgerEntry[] = [
  {
    id: "5",
    type: "cardRedeem",
    amount: 1000,
    balanceAfter: 1200,
    note: "创作积分充值",
    createdAt: new Date(now - 22 * 60 * 60 * 1000).toISOString(),
    referenceId: "card_demo_001"
  },
  {
    id: "4",
    type: "adminAdjustment",
    amount: 200,
    balanceAfter: 200,
    note: "演示账号积分",
    createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
  }
];
const mockTasks: GenerationTask[] = [];
const mockTaskOutputSettings = new Map<
  string,
  { outputFormat: OutputFormat; outputCompression?: number }
>();

const delay = (ms = 300) => new Promise((resolve) => window.setTimeout(resolve, ms));
const id = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
const createdAt = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
const categoryNames = Array.from(new Set(promptTemplates.map((template) => template.category)));
const categoryIds = new Map(categoryNames.map((name, index) => [name, String(index + 1)]));

const mockUser = (): ClientUser => ({
  id: "1",
  username: "user_8000_demo",
  phone: "13800138000",
  points: mockBalance,
  status: "active",
  createdAt
});

const mockTemplates: GenerationTemplate[] = promptTemplates.map((template, index) => ({
  id: String(index + 1),
  categoryId: categoryIds.get(template.category) || "1",
  categoryName: template.category,
  name: template.title,
  description: template.description,
  mode: template.mode === "image-to-image" ? "imageToImage" : "textToImage",
  ...(template.mode === "image-to-image" ? { sourceImage: template.sourceImage || template.previewImage } : {}),
  effectImage: template.previewImage,
  prompt: template.prompt,
  width: template.width || 1024,
  height: template.height || 1024,
  quality: template.quality || "auto",
  sort: index + 1,
  status: "published",
  useCount: 0,
  createdAt,
  updatedAt: createdAt
}));

function paginate<T>(items: T[], page = 1, pageSize = 20): ClientPagination<T> {
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: items.length,
    page,
    pageSize
  };
}

function advanceMockTask(task: GenerationTask) {
  if (task.status !== "pending" && task.status !== "processing") return task;
  const elapsed = Date.now() - new Date(task.createdAt).getTime();
  if (elapsed >= 8000) {
    const outputSettings = mockTaskOutputSettings.get(task.id) ?? { outputFormat: "jpeg" as const };
    const imageFormat = outputSettings.outputFormat === "jpeg" ? "jpg" : outputSettings.outputFormat;
    const mimeType = outputSettings.outputFormat === "jpeg" ? "image/jpeg" : `image/${outputSettings.outputFormat}`;
    const imageUrl = sampleImages[0]
      .replace("auto=format", `fm=${imageFormat}`)
      .replace(/q=\d+/u, `q=${Math.max(1, outputSettings.outputCompression ?? 100)}`);
    task.status = "succeeded";
    task.attemptCount = 1;
    task.startedAt ||= new Date(new Date(task.createdAt).getTime() + 1800).toISOString();
    task.finishedAt = new Date().toISOString();
    task.outputAsset = {
      id: `output_${task.id}`,
      kind: "output",
      url: `${imageUrl}&sig=${task.id}`,
      mimeType,
      size: 320000,
      createdAt: task.finishedAt
    };
  } else if (elapsed >= 1800) {
    task.status = "processing";
    task.attemptCount = 1;
    task.startedAt ||= new Date().toISOString();
  }
  return task;
}

export const mockApi = {
  async sendSms(_phone: string, _purpose: "register" | "passwordReset") {
    await delay(250);
    return { accepted: true as const, cooldownSeconds: 60, expiresInSeconds: 300 };
  },

  async login(phone: string, _password: string): Promise<ClientAuthResponse> {
    await delay(400);
    return {
      user: { ...mockUser(), phone },
      token: "mock_access_token",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    };
  },

  async register(phone: string, _code: string, password: string) {
    return this.login(phone, password);
  },

  async resetPassword(_phone: string, _code: string, _password: string) {
    await delay(350);
    return { success: true as const };
  },

  async capabilities(): Promise<GenerationSettings> {
    await delay(120);
    return {
      textToImageCost: 10,
      imageToImageCost: 15,
      cardPurchaseUrl: "https://example.com/cards",
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
  },

  async templateCategories(): Promise<{ items: TemplateCategory[] }> {
    await delay(120);
    return {
      items: categoryNames.map((name, index) => ({
        id: String(index + 1),
        name,
        sort: index + 1,
        status: "active",
        templateCount: mockTemplates.filter((template) => template.categoryName === name).length
      }))
    };
  },

  async templates(options: {
    page?: number;
    pageSize?: number;
    mode?: ClientGenerationMode;
    categoryId?: string;
  } = {}) {
    await delay(180);
    const filtered = mockTemplates.filter(
      (template) =>
        (!options.mode || template.mode === options.mode) &&
        (!options.categoryId || template.categoryId === options.categoryId)
    );
    return paginate(filtered, options.page, options.pageSize || 24);
  },

  async template(templateId: string) {
    await delay(100);
    const template = mockTemplates.find((item) => item.id === templateId);
    if (!template) throw new Error("模板不存在");
    return template;
  },

  async me() {
    await delay(120);
    return mockUser();
  },

  async logout() {
    await delay(80);
  },

  async redeemCard(_code: string): Promise<CardRedeemResult> {
    await delay(400);
    const points = 100;
    mockBalance += points;
    mockTransactions.unshift({
      id: id("point"),
      type: "cardRedeem",
      amount: points,
      balanceAfter: mockBalance,
      note: "卡密兑换",
      createdAt: new Date().toISOString()
    });
    return { points, balance: mockBalance };
  },

  async points(page = 1, pageSize = 50) {
    await delay(160);
    return paginate(mockTransactions, page, pageSize);
  },

  async uploadImage(file: File): Promise<ClientAsset> {
    await delay(300);
    return {
      id: id("asset"),
      kind: "input",
      url: URL.createObjectURL(file),
      mimeType: file.type,
      size: file.size,
      createdAt: new Date().toISOString()
    };
  },

  async createTask(input: CreateGenerationTaskInput): Promise<GenerationTask> {
    await delay(900);
    const mode = input.mode || "textToImage";
    const pointsCost = mode === "imageToImage" ? 15 : 10;
    if (mockBalance < pointsCost) throw new Error("积分不足，请充值后继续生成。");
    mockBalance -= pointsCost;

    const taskId = id("task");
    const outputFormat = input.outputFormat ?? "png";
    const outputCompression =
      outputFormat === "png"
        ? undefined
        : Math.min(100, Math.max(0, input.outputCompression ?? 100));
    const task: GenerationTask = {
      id: taskId,
      requestId: id("request"),
      mode,
      prompt: input.prompt || "Mock prompt",
      ...(input.templateId ? { templateId: input.templateId } : {}),
      width: input.width || 1024,
      height: input.height || 1024,
      quality: input.quality || "auto",
      pointsCost,
      status: "pending",
      attemptCount: 0,
      createdAt: new Date().toISOString()
    };
    mockTaskOutputSettings.set(taskId, {
      outputFormat,
      ...(outputCompression !== undefined ? { outputCompression } : {})
    });
    mockTasks.unshift(task);
    mockTransactions.unshift({
      id: id("point"),
      type: "taskCharge",
      amount: -pointsCost,
      balanceAfter: mockBalance,
      referenceId: task.id,
      note: mode === "imageToImage" ? "图生图任务" : "文生图任务",
      createdAt: task.createdAt
    });
    return task;
  },

  async tasks(options: {
    page?: number;
    pageSize?: number;
    status?: GenerationTaskStatus;
    mode?: ClientGenerationMode;
  } = {}) {
    await delay(140);
    mockTasks.forEach(advanceMockTask);
    const filtered = mockTasks.filter(
      (task) => (!options.status || task.status === options.status) && (!options.mode || task.mode === options.mode)
    );
    return paginate(filtered, options.page, options.pageSize || 20);
  },

  async task(taskId: string) {
    await delay(120);
    const task = mockTasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在");
    return advanceMockTask(task);
  },

  async cancelTask(taskId: string) {
    await delay(120);
    const task = mockTasks.find((item) => item.id === taskId);
    if (!task) throw new Error("任务不存在");
    advanceMockTask(task);
    if (task.status !== "pending") throw new Error("只有排队中的任务可以取消");
    task.status = "cancelled";
    task.finishedAt = new Date().toISOString();
    return task;
  }
};
