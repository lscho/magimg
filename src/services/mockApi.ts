import { sampleImages } from "@/constants/defaults";
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

let mockBalance = 1200;
const now = Date.now();
const mockTransactions: CreditTransaction[] = [
  {
    id: "credit_recharge_demo",
    kind: "recharge",
    amount: 1000,
    balanceAfter: 1200,
    description: "创作包充值到账",
    createdAt: new Date(now - 22 * 60 * 60 * 1000).toISOString(),
    referenceId: "order_demo_001"
  },
  {
    id: "credit_bonus_demo",
    kind: "bonus",
    amount: 200,
    balanceAfter: 200,
    description: "新用户注册赠送",
    createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
  }
];

const delay = (ms = 650) => new Promise((resolve) => window.setTimeout(resolve, ms));
const ok = <T>(data: T): ApiResponse<T> => ({ code: 0, message: "ok", data });
const id = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;

export const mockApi = {
  async login(email: string): Promise<ApiResponse<UserSession>> {
    await delay(450);
    return ok({
      accessToken: "mock_access_token",
      user: {
        id: "user_mock_001",
        email,
        nickname: email.split("@")[0] || "幻画用户"
      }
    });
  },

  async register(email: string): Promise<ApiResponse<UserSession>> {
    return this.login(email);
  },

  async me(): Promise<ApiResponse<UserSession["user"]>> {
    await delay(200);
    return ok({ id: "user_mock_001", email: "demo@huanhua.ai", nickname: "幻画用户" });
  },

  async balance(): Promise<ApiResponse<CreditBalance>> {
    await delay(180);
    return ok({ balance: mockBalance, frozen: 0, updatedAt: new Date().toISOString() });
  },

  async transactions(limit = 50): Promise<ApiResponse<CreditTransaction[]>> {
    await delay(240);
    return ok(mockTransactions.slice(0, limit));
  },

  async packages(): Promise<ApiResponse<CreditPackage[]>> {
    await delay(220);
    return ok([
      { id: "starter", title: "灵感包", credits: 600, bonusCredits: 0, priceCents: 1900, currency: "CNY" },
      { id: "creator", title: "创作包", credits: 1800, bonusCredits: 200, priceCents: 4900, currency: "CNY", recommended: true },
      { id: "studio", title: "工作室包", credits: 5200, bonusCredits: 800, priceCents: 12900, currency: "CNY" }
    ]);
  },

  async createOrder(packageId: string): Promise<ApiResponse<RechargeOrder>> {
    const packages = (await this.packages()).data;
    const selected = packages.find((item) => item.id === packageId) ?? packages[0];
    await delay(360);
    return ok({
      id: id("order"),
      packageId: selected.id,
      amountCents: selected.priceCents,
      credits: selected.credits + selected.bonusCredits,
      status: "pending",
      paymentUrl: `https://pay.example.com/huanhua-ai?order=${selected.id}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });
  },

  async order(orderId: string): Promise<ApiResponse<RechargeOrder>> {
    await delay(300);
    return ok({
      id: orderId,
      packageId: "creator",
      amountCents: 4900,
      credits: 2000,
      status: "pending",
      paymentUrl: `https://pay.example.com/huanhua-ai?order=${orderId}`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    });
  },

  async generate(params: ImageParams): Promise<ApiResponse<GenerateResponse>> {
    await delay(1100);
    const costCredits = Math.max(1, params.n) * 7;
    if (mockBalance < costCredits) {
      throw new Error("积分不足，请充值后继续生成。");
    }
    mockBalance -= costCredits;
    const generationId = id("gen");
    mockTransactions.unshift({
      id: id("credit"),
      kind: "generation",
      amount: -costCredits,
      balanceAfter: mockBalance,
      description: `图片生成 · ${params.n} 张`,
      createdAt: new Date().toISOString(),
      referenceId: generationId
    });
    const [width, height] = params.size === "auto" ? [1024, 1024] : params.size.split("x").map(Number);
    return ok({
      generationId,
      status: "succeeded",
      costCredits,
      balanceAfter: mockBalance,
      created: Math.floor(Date.now() / 1000),
      background: params.background === "auto" ? "opaque" : params.background,
      outputFormat: params.outputFormat,
      responseFormat: params.responseFormat,
      quality: params.quality,
      size: params.size,
      images: Array.from({ length: params.n }, (_, index) => ({
        id: id("img"),
        remoteUrl: `${sampleImages[index % sampleImages.length]}&sig=${generationId}_${index}`,
        width,
        height
      }))
    });
  },

  async generation(generationId: string): Promise<ApiResponse<GenerateResponse>> {
    await delay(300);
    return ok({
      generationId,
      status: "succeeded",
      costCredits: 24,
      balanceAfter: mockBalance,
      images: sampleImages.slice(0, 4).map((remoteUrl, index) => ({
        id: id("img"),
        remoteUrl,
        width: 1024,
        height: 1024 + index
      }))
    });
  }
};
