import { mockApi } from "@/services/mockApi";
import type {
  ApiResponse,
  CreditBalance,
  CreditPackage,
  CreditTransaction,
  GenerateResponse,
  ImageParams,
  RechargeOrder,
  UserSession
} from "@/types";

const useMock = import.meta.env.VITE_USE_MOCK_API !== "false";
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

let token: string | null = null;

export function setAccessToken(nextToken: string | null) {
  token = nextToken;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  const payload = (await response.json()) as ApiResponse<T>;
  if (!response.ok || payload.code !== 0) {
    throw new Error(payload.message || `请求失败：${response.status}`);
  }
  return payload;
}

function toImageGenerationBody(params: ImageParams) {
  return {
    prompt: params.prompt,
    model: "gpt-image-2",
    n: params.n,
    size: params.size,
    background: params.background,
    moderation: params.moderation,
    ...(params.outputFormat !== "png" ? { output_compression: params.outputCompression } : {}),
    output_format: params.outputFormat,
    partial_images: params.partialImages,
    quality: params.quality,
    stream: params.stream,
    ...(params.user ? { user: params.user } : {}),
    ...(params.referenceImagePath ? { referenceImagePath: params.referenceImagePath } : {}),
    ...(typeof params.strength === "number" ? { strength: params.strength } : {}),
    ...(typeof params.preserveComposition === "boolean" ? { preserveComposition: params.preserveComposition } : {})
  };
}

export const apiClient = {
  async login(email: string, password: string): Promise<ApiResponse<UserSession>> {
    if (useMock) return mockApi.login(email);
    return request<UserSession>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },

  async register(email: string, password: string): Promise<ApiResponse<UserSession>> {
    if (useMock) return mockApi.register(email);
    return request<UserSession>("/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },

  async logout(): Promise<void> {
    if (!useMock) {
      await request("/v1/auth/logout", { method: "POST" });
    }
  },

  me: () => (useMock ? mockApi.me() : request<UserSession["user"]>("/v1/users/me")),
  balance: () => (useMock ? mockApi.balance() : request<CreditBalance>("/v1/credits/balance")),
  transactions: (limit = 50) =>
    useMock ? mockApi.transactions(limit) : request<CreditTransaction[]>(`/v1/credits/transactions?limit=${limit}`),
  packages: () => (useMock ? mockApi.packages() : request<CreditPackage[]>("/v1/credits/packages")),

  createOrder(packageId: string): Promise<ApiResponse<RechargeOrder>> {
    if (useMock) return mockApi.createOrder(packageId);
    return request<RechargeOrder>("/v1/credits/orders", {
      method: "POST",
      body: JSON.stringify({ packageId })
    });
  },

  order(orderId: string) {
    return useMock ? mockApi.order(orderId) : request<RechargeOrder>(`/v1/credits/orders/${orderId}`);
  },

  generateTextToImage(params: ImageParams) {
    if (useMock) return mockApi.generate(params);
    return request<GenerateResponse>("/v1/generations/text-to-image", {
      method: "POST",
      body: JSON.stringify(toImageGenerationBody(params))
    });
  },

  generateImageToImage(params: ImageParams) {
    if (useMock) return mockApi.generate(params);
    return request<GenerateResponse>("/v1/generations/image-to-image", {
      method: "POST",
      body: JSON.stringify(toImageGenerationBody(params))
    });
  },

  generation(generationId: string) {
    return useMock ? mockApi.generation(generationId) : request<GenerateResponse>(`/v1/generations/${generationId}`);
  }
};
