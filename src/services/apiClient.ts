import { fetchHttp } from "@/services/desktop";
import type {
  CardRedeemResult,
  ClientAsset,
  ClientAuthResponse,
  ClientGenerationMode,
  ClientPagination,
  ClientSettings,
  ClientUser,
  CreateGenerationTaskInput,
  GenerationSettings,
  GenerationTask,
  GenerationTaskStatus,
  GenerationTemplate,
  MattingChargeResult,
  MattingRefundResult,
  PointLedgerEntry,
  TemplateCategory
} from "@/types";

const CLIENT_API_PREFIX = "/api/client/v1";
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

let token: string | null = null;
let apiBaseUrl = runtimeApiBaseUrl(configuredApiBaseUrl);
let unauthorizedHandler: (() => void | Promise<void>) | null = null;

interface ApiErrorPayload {
  statusCode?: number;
  message?: string | string[];
}

interface RequestOptions extends RequestInit {
  idempotencyKey?: string;
}

export class ApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

export function setAccessToken(nextToken: string | null) {
  token = nextToken;
}

export function setApiBaseUrl(nextBaseUrl: string) {
  apiBaseUrl = runtimeApiBaseUrl(nextBaseUrl);
}

export function setUnauthorizedHandler(handler: (() => void | Promise<void>) | null) {
  unauthorizedHandler = handler;
}

function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseIncludesPrefix = apiBaseUrl.endsWith(CLIENT_API_PREFIX);
  return `${apiBaseUrl}${baseIncludesPrefix ? "" : CLIENT_API_PREFIX}${normalizedPath}`;
}

function runtimeApiBaseUrl(nextBaseUrl: string) {
  const normalized = nextBaseUrl.trim().replace(/\/+$/u, "");
  const configured = configuredApiBaseUrl.trim().replace(/\/+$/u, "");
  return import.meta.env.DEV && normalized === configured ? "" : normalized;
}

function defaultErrorMessage(statusCode: number) {
  if (statusCode === 401) return "请先登录或重新登录。";
  if (statusCode === 403) return "当前账号无法执行此操作。";
  if (statusCode === 429) return "请求过于频繁，请稍后再试。";
  if (statusCode >= 500) return "服务暂时不可用，请稍后重试。";
  return `请求失败（${statusCode}），请稍后重试。`;
}

function errorMessage(payload: ApiErrorPayload | null, statusCode: number) {
  const message = payload?.message;
  if (Array.isArray(message)) {
    const combined = message.map((item) => item.trim()).filter(Boolean).join("；");
    if (combined) return combined;
  }
  if (typeof message === "string" && message.trim()) return message.trim();
  return defaultErrorMessage(statusCode);
}

export function resolveApiAssetUrl(path: string) {
  if (/^https?:\/\//u.test(path) || path.startsWith("data:") || path.startsWith("blob:")) {
    return path;
  }

  const base = apiBaseUrl || window.location.origin;
  try {
    return new URL(path, `${base.replace(/\/+$/u, "")}/`).toString();
  } catch {
    return path;
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { idempotencyKey, ...fetchOptions } = options;
  const isFormData = fetchOptions.body instanceof FormData;
  const requestUrl = buildApiUrl(path);
  let response: Response;
  try {
    response = await fetchHttp(requestUrl, {
      ...fetchOptions,
      headers: {
        ...(!isFormData && fetchOptions.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...fetchOptions.headers
      }
    });
  } catch (exception) {
    console.error("API request failed", {
      url: requestUrl,
      method: fetchOptions.method || "GET",
      exception
    });
    throw new ApiError("无法连接服务，请检查网络或接口地址。", 0);
  }

  let payload: ApiErrorPayload | T | null = null;
  try {
    payload = (await response.json()) as ApiErrorPayload | T;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null;
    if (response.status === 401 && unauthorizedHandler) {
      await unauthorizedHandler();
    }
    throw new ApiError(errorMessage(errorPayload, response.status), response.status);
  }

  return payload as T;
}

function queryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") search.set(key, String(value));
  });
  const value = search.toString();
  return value ? `?${value}` : "";
}

function toCreateTaskBody(input: CreateGenerationTaskInput) {
  const { outputFormat, outputCompression, ...body } = input;
  return {
    ...body,
    ...(outputFormat ? { outputFormat } : {}),
    ...(outputFormat !== "png" && outputCompression !== undefined
      ? { output_compression: outputCompression }
      : {})
  };
}

function idempotencyKey() {
  return `huanhua:${crypto.randomUUID()}`;
}

export const apiClient = {
  sendSms(phone: string, purpose: "register" | "passwordReset") {
    return request<{ accepted: true; cooldownSeconds: number; expiresInSeconds: number }>("/auth/sms/send", {
      method: "POST",
      body: JSON.stringify({ phone, purpose })
    });
  },

  login(phone: string, password: string, deviceName?: string) {
    return request<ClientAuthResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone, password, ...(deviceName ? { deviceName } : {}) })
    });
  },

  register(phone: string, code: string, password: string, deviceName?: string) {
    return request<ClientAuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ phone, code, password, ...(deviceName ? { deviceName } : {}) })
    });
  },

  resetPassword(phone: string, code: string, password: string) {
    return request<{ success: true }>("/auth/password/reset", {
      method: "POST",
      body: JSON.stringify({ phone, code, password })
    });
  },

  capabilities() {
    return request<GenerationSettings>("/capabilities");
  },

  templateCategories() {
    return request<{ items: TemplateCategory[] }>("/template-categories");
  },

  templates(options: {
    page?: number;
    pageSize?: number;
    mode?: ClientGenerationMode;
    categoryId?: string;
  } = {}) {
    return request<ClientPagination<GenerationTemplate>>(
      `/templates${queryString({
        page: options.page,
        pageSize: options.pageSize,
        mode: options.mode,
        categoryId: options.categoryId
      })}`
    );
  },

  template(id: string) {
    return request<GenerationTemplate>(`/templates/${encodeURIComponent(id)}`);
  },

  me() {
    return request<ClientUser>("/me");
  },

  async logout() {
    await request<{ success: true }>("/auth/logout", { method: "POST" });
  },

  redeemCard(code: string) {
    return request<CardRedeemResult>("/cards/redeem", {
      method: "POST",
      body: JSON.stringify({ code })
    });
  },

  points(page = 1, pageSize = 50) {
    return request<ClientPagination<PointLedgerEntry>>(`/points${queryString({ page, pageSize })}`);
  },

  uploadImage(file: File) {
    const body = new FormData();
    body.append("file", file, file.name);
    return request<ClientAsset>("/uploads/images", { method: "POST", body });
  },

  createTask(input: CreateGenerationTaskInput) {
    return request<GenerationTask>("/tasks", {
      method: "POST",
      body: JSON.stringify(toCreateTaskBody(input)),
      idempotencyKey: idempotencyKey()
    });
  },

  tasks(options: {
    page?: number;
    pageSize?: number;
    status?: GenerationTaskStatus;
    mode?: ClientGenerationMode;
  } = {}) {
    return request<ClientPagination<GenerationTask>>(
      `/tasks${queryString({
        page: options.page,
        pageSize: options.pageSize,
        status: options.status,
        mode: options.mode
      })}`
    );
  },

  task(id: string) {
    return request<GenerationTask>(`/tasks/${encodeURIComponent(id)}`);
  },

  cancelTask(id: string) {
    return request<GenerationTask>(`/tasks/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  },

  chargeMatting() {
    return request<MattingChargeResult>("/matting", {
      method: "POST",
      body: JSON.stringify({}),
      idempotencyKey: idempotencyKey()
    });
  },

  refundMatting(mattingId: string) {
    return request<MattingRefundResult>(
      `/matting/${encodeURIComponent(mattingId)}/refund`,
      { method: "POST" }
    );
  },

  config() {
    return request<ClientSettings>("/config");
  },

  submitFeedback(content: string, contact?: string) {
    return request<{ id: string; createdAt: string }>("/feedback", {
      method: "POST",
      body: JSON.stringify({ content, ...(contact ? { contact } : {}) })
    });
  }
};
