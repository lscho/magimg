export type GenerationMode = "text-to-image" | "image-to-image";
export type GenerationStatus = "queued" | "processing" | "succeeded" | "failed";
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
  | "1024x1792";
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
}

export interface GeneratedImage {
  id: string;
  remoteUrl: string;
  localPath?: string;
  width: number;
  height: number;
}

export interface GenerationRecord {
  id: string;
  generationId: string;
  mode: GenerationMode;
  params: ImageParams;
  images: GeneratedImage[];
  status: GenerationStatus;
  costCredits: number;
  balanceAfter: number;
  createdAt: string;
  errorMessage?: string;
}

export interface UserSession {
  accessToken: string;
  user: {
    id: string;
    nickname: string;
    email: string;
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
  mode: GenerationMode;
  title: string;
  category: string;
  description: string;
  prompt: string;
  tags: string[];
  previewImage: string;
  previewCrop?: "full" | "source" | "effect";
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
  session: UserSession | null;
}
