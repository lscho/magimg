import { defaultParams } from "@/constants/defaults";
import { ApiError, resolveApiAssetUrl } from "@/services/apiClient";
import type {
  ClientAuthResponse,
  ClientGenerationMode,
  CreditTransaction,
  CreditTransactionKind,
  GenerationMode,
  GenerationRecord,
  GenerationSettings,
  GenerationStatus,
  GenerationTask,
  GeneratedImage,
  ImageParams,
  PointLedgerEntry,
  SupportedQuality,
  UserSession
} from "@/types";

export const fallbackCapabilities: GenerationSettings = {
  textToImageCost: 10,
  imageToImageCost: 15,
  mattingCost: 5,
  autoLayerEnabled: false,
  autoLayerCost: 20,
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

export type GenerationErrorKind =
  | "none"
  | "insufficientCredits"
  | "authentication"
  | "general";

export function toClientMode(mode: GenerationMode): ClientGenerationMode {
  return mode === "image-to-image" ? "imageToImage" : "textToImage";
}

export function toGenerationMode(mode: ClientGenerationMode): GenerationMode {
  return mode === "imageToImage" ? "image-to-image" : "text-to-image";
}

export function toGenerationStatus(status: GenerationTask["status"]): GenerationStatus {
  return status === "pending" ? "queued" : status;
}

export function isGenerationInProgress(record: GenerationRecord | null) {
  return record?.status === "queued" || record?.status === "processing";
}

export function toTaskStatus(status?: GenerationStatus): GenerationTask["status"] | null {
  if (!status) return null;
  return status === "queued" ? "pending" : status;
}

export function toSession(response: ClientAuthResponse): UserSession {
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

export function isPersistedSession(value: unknown): value is UserSession {
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

export function toCreditTransaction(entry: PointLedgerEntry): CreditTransaction {
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

export function taskParams(task: GenerationTask): ImageParams {
  return {
    ...defaultParams,
    prompt: task.prompt,
    size: `${task.width}x${task.height}`,
    quality: task.quality,
    templateId: task.templateId
  };
}

export function taskToRecord(task: GenerationTask, balanceAfter: number): GenerationRecord {
  const inputs = task.inputAssets || (task.inputAsset ? [task.inputAsset] : []);
  const inputImages = inputs.map(input => ({
    id: input.id,
    remoteUrl: resolveApiAssetUrl(input.url),
    width: task.width,
    height: task.height,
    mimeType: input.mimeType
  }));
  const output = task.outputAsset;
  return {
    id: `server_${task.id}`,
    generationId: task.id,
    mode: toGenerationMode(task.mode),
    params: taskParams(task),
    inputImage: inputImages[0],
    inputImages: inputImages.length ? inputImages : undefined,
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

export function extensionForMime(mimeType?: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

/**
 * 服务端资源是任务真相源，本地路径只作为同一 asset id 的下载缓存补充。
 * 不能按数组位置合并，否则任务重新生成后会把旧文件路径挂到新资源上。
 */
export function mergeServerImage(
  serverImage: GeneratedImage,
  localImages: GeneratedImage[]
): GeneratedImage {
  const localMatch = localImages.find((local) => local.id === serverImage.id);
  return localMatch?.localPath
    ? { ...serverImage, localPath: localMatch.localPath }
    : serverImage;
}

export function parseSize(size: ImageParams["size"]) {
  if (size === "auto") return {};
  const match = /^(\d+)x(\d+)$/u.exec(size);
  if (!match) return {};
  return { width: Number(match[1]), height: Number(match[2]) };
}

export function isSupportedQuality(
  quality: ImageParams["quality"]
): quality is SupportedQuality {
  return quality === "auto" || quality === "low" || quality === "medium" || quality === "high";
}

export function generationErrorDetails(exception: unknown): {
  kind: Exclude<GenerationErrorKind, "none">;
  message: string;
} {
  const message = exception instanceof Error ? exception.message.trim() : "";
  const isInsufficientCredits =
    /(?:积分|余额).*(?:不足|不够)|(?:不足|不够).*(?:积分|余额)/u.test(message);

  if (
    (exception instanceof ApiError && exception.statusCode === 409 && isInsufficientCredits) ||
    isInsufficientCredits
  ) {
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
