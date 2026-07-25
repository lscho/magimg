export type GenerationMode = "text-to-image" | "image-to-image";
export type ClientGenerationMode = "textToImage" | "imageToImage";
export type GenerationStatus = "queued" | "processing" | "succeeded" | "failed" | "cancelled";
export type GenerationTaskStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled";
export type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9";
export type ImageModelName = "gpt-image-2" | "gpt-image-1.5" | "gpt-image-1" | "gpt-image-1-mini" | "dall-e-2" | "dall-e-3";
export type ImageSize =
  | "auto"
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "2048x2048"
  | "2048x1152"
  | "3840x2160"
  | "2160x3840"
  | "256x256"
  | "512x512"
  | "1792x1024"
  | "1024x1792"
  | `${number}x${number}`;
export type OutputFormat = "png" | "jpeg" | "webp";
export type ResponseFormat = "url" | "b64_json";
export type Background = "transparent" | "opaque" | "auto";
export type Quality = "auto" | "low" | "medium" | "high" | "hd" | "standard";
export type Style = "vivid" | "natural";

export interface ImageParams {
  prompt: string;
  model: ImageModelName;
  size: ImageSize;
  n: number;
  outputFormat: OutputFormat;
  responseFormat: ResponseFormat;
  background: Background;
  moderation: "auto" | "low";
  outputCompression: number;
  quality: Quality;
  stream: boolean;
  partialImages: number;
  style: Style;
  user: string;
  strength?: number;
  preserveComposition?: boolean;
  referenceImagePath?: string;
  templateId?: string;
}

export interface GeneratedImage {
  id: string;
  remoteUrl: string;
  localPath?: string;
  width: number;
  height: number;
  mimeType?: string;
}

export interface GenerationRecord {
  id: string;
  generationId: string;
  mode: GenerationMode;
  params: ImageParams;
  inputImage?: GeneratedImage;
  images: GeneratedImage[];
  status: GenerationStatus;
  costCredits: number;
  balanceAfter: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  errorMessage?: string;
}

export interface UserSession {
  accessToken: string;
  expiresAt?: string;
  user: {
    id: string;
    nickname: string;
    phone?: string;
    email?: string;
    avatarUrl?: string;
  };
}

export interface CreditBalance {
  balance: number;
  frozen: number;
  updatedAt: string;
}

export type CreditTransactionKind = "recharge" | "generation" | "refund" | "bonus" | "adjustment";

export interface CreditTransaction {
  id: string;
  kind: CreditTransactionKind;
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
  referenceId?: string;
}

export interface PromptTemplate {
  id: string;
  templateId?: string;
  mode: GenerationMode;
  title: string;
  category: string;
  description: string;
  prompt: string;
  tags: string[];
  previewImage: string;
  sourceImage?: string;
  width?: number;
  height?: number;
  quality?: SupportedQuality;
  previewCrop?: "full" | "source" | "effect";
}

export type SupportedQuality = "auto" | "low" | "medium" | "high";

export interface ClientUser {
  id: string;
  username: string;
  phone?: string;
  email?: string;
  points: number;
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt?: string;
}

export interface ClientAuthResponse {
  user: ClientUser;
  token: string;
  expiresAt: string;
}

export interface ClientPagination<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface GenerationSettings {
  textToImageCost: number;
  imageToImageCost: number;
  cardPurchaseUrl?: string;
  maxAttempts: number;
  uploadMaxBytes: number;
  supportedMimeTypes: string[];
  supportedQualities: SupportedQuality[];
  sizeRules: {
    edgeStep: number;
    maxEdge: number;
    maxAspectRatio: number;
    minPixels: number;
    maxPixels: number;
  };
}

export interface TemplateCategory {
  id: string;
  name: string;
  description?: string;
  sort: number;
  status: "active" | "disabled";
  templateCount?: number;
}

export interface GenerationTemplate {
  id: string;
  categoryId: string;
  categoryName?: string;
  name: string;
  description?: string;
  mode: ClientGenerationMode;
  sourceImage?: string;
  effectImage: string;
  prompt: string;
  width: number;
  height: number;
  quality: SupportedQuality;
  sort: number;
  status: "draft" | "published";
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClientAsset {
  id: string;
  kind: "input" | "output";
  url: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface GenerationTask {
  id: string;
  requestId: string;
  mode: ClientGenerationMode;
  prompt: string;
  templateId?: string;
  inputAsset?: ClientAsset;
  outputAsset?: ClientAsset;
  width: number;
  height: number;
  quality: SupportedQuality;
  pointsCost: number;
  status: GenerationTaskStatus;
  attemptCount: number;
  errorMessage?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export type PointLedgerType = "cardRedeem" | "taskCharge" | "taskRefund" | "adminAdjustment";

export interface PointLedgerEntry {
  id: string;
  type: PointLedgerType;
  amount: number;
  balanceAfter: number;
  referenceId?: string;
  note?: string;
  createdAt: string;
}

export interface CardRedeemResult {
  points: number;
  balance: number;
}

export interface ClientSettings {
  groupQrcode: string;
}

export interface CreateGenerationTaskInput {
  mode?: ClientGenerationMode;
  prompt?: string;
  templateId?: string;
  inputAssetId?: string;
  width?: number;
  height?: number;
  quality?: SupportedQuality;
  outputFormat?: OutputFormat;
  outputCompression?: number;
}

export interface SelectedImageFile {
  name: string;
  path: string;
  file: File;
}

export interface CreditPackage {
  id: string;
  title: string;
  credits: number;
  bonusCredits: number;
  priceCents: number;
  currency: "CNY";
  recommended?: boolean;
}

export interface RechargeOrder {
  id: string;
  packageId: string;
  amountCents: number;
  credits: number;
  status: "pending" | "paid" | "expired" | "cancelled";
  paymentUrl: string;
  createdAt: string;
  expiresAt: string;
}

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface GenerateResponse {
  generationId: string;
  status: GenerationStatus;
  costCredits: number;
  balanceAfter: number;
  images: GeneratedImage[];
  created?: number;
  background?: Background;
  outputFormat?: OutputFormat;
  responseFormat?: ResponseFormat;
  quality?: Quality;
  size?: ImageSize;
  usage?: {
    input_tokens: number;
    input_tokens_details: {
      image_tokens: number;
      text_tokens: number;
    };
    output_tokens: number;
    total_tokens: number;
    output_tokens_details?: {
      image_tokens: number;
      text_tokens: number;
    };
  };
}

export interface AppSettings {
  apiBaseUrl: string;
  saveDirectory: string;
  autoSave: boolean;
  defaultParams: ImageParams;
}

export interface LocalDatabase {
  settings: AppSettings;
  history: GenerationRecord[];
  hiddenHistoryIds: string[];
  session: UserSession | null;
}
