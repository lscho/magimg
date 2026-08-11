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
  mattingCost: number;
  autoLayerEnabled?: boolean;
  autoLayerCost?: number;
  /** 云端背景修复未部署时为 false 或缺省。 */
  backgroundRepairEnabled?: boolean;
  backgroundRepairCost?: number;
  backgroundRepairMaxBytes?: number;
  backgroundRepairMaxPixels?: number;
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

export interface MattingChargeResult {
  mattingId: string;
  cost: number;
  balance: number;
  mode?: MattingMode;
}

export type MattingMode = CutoutRepairMode | "autoLayer";

export interface MattingRefundResult {
  cost: number;
  balance: number;
}

export type BackgroundRepairStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export interface BackgroundRepairTask {
  id: string;
  inputAssetId: string;
  status: BackgroundRepairStatus;
  cost: number;
  balance: number;
  outputUrl?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateBackgroundRepairInput {
  image?: File;
  inputAssetId?: string;
  mask: Blob;
  mattingId: string;
  selectionBoxes: CutoutSelectionBox[];
}

export type AutoLayerTaskStatus = BackgroundRepairStatus;

export interface AutoLayerTask {
  id: string;
  inputAssetId: string;
  status: AutoLayerTaskStatus;
  cost: number;
  balance: number;
  outputUrl?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface CreateAutoLayerTaskBaseInput {
  image?: File;
  inputAssetId?: string;
  mattingId: string;
  idempotencyKey?: string;
}

/** 新整页背景任务提交框选；蒙版分支仅保留服务端旧任务兼容能力。 */
export type CreateAutoLayerTaskInput = CreateAutoLayerTaskBaseInput & (
  | { selectionBoxes: CutoutSelectionBox[]; mask?: never }
  | { mask: Blob; selectionBoxes?: never }
);

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

export type PointLedgerType =
  | "cardRedeem"
  | "taskCharge"
  | "taskRefund"
  | "mattingCharge"
  | "mattingRefund"
  | "adminAdjustment";

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

/* ---------- 图片压缩（桌面本地能力） ---------- */

export type CompressionFormat = "png" | "jpeg" | "webp";
export type CompressionInputMode = "files" | "folder";
export type CompressionConflictPolicy = "skip" | "overwrite" | "rename";
export type CompressionItemStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "noBenefit"
  | "skipped"
  | "failed"
  | "cancelled";

export interface CompressionSettings {
  conflictPolicy: CompressionConflictPolicy;
  skipNoBenefit: boolean;
}

export interface CompressionSourceItem {
  id: string;
  relativePath: string;
  format: CompressionFormat;
  width: number;
  height: number;
  size: number;
}

export interface CompressionPreparedSession {
  sessionId: string;
  inputMode: CompressionInputMode;
  sourceName: string;
  items: CompressionSourceItem[];
  rejectedCount: number;
  totalBytes: number;
}

export interface CompressionSummary {
  total: number;
  succeeded: number;
  noBenefit: number;
  skipped: number;
  failed: number;
  cancelled: number;
  originalBytes: number;
  outputBytes: number;
  savedBytes: number;
  wasCancelled: boolean;
}

export interface CompressionSaveItem {
  itemId: string;
  status: "saved" | "skipped" | "failed";
  outputRelativePath: string | null;
  message: string | null;
}

export interface CompressionSaveSummary {
  saved: number;
  skipped: number;
  failed: number;
  items: CompressionSaveItem[];
}

export type CompressionProgressEvent =
  | { type: "started"; total: number }
  | {
      type: "itemStarted";
      itemId: string;
      index: number;
      total: number;
      relativePath: string;
    }
  | {
      type: "itemFinished";
      itemId: string;
      index: number;
      status: Exclude<CompressionItemStatus, "pending" | "processing">;
      outputRelativePath: string | null;
      outputSize: number | null;
      savedPercent: number | null;
      message: string | null;
    }
  | { type: "finished"; summary: CompressionSummary };

/* ---------- AI 抠图（客户端本地模型） ---------- */

/**
 * 客户端抠图模型描述符。
 * 模型包由用户主动下载到 appDataDir/models/，不随安装包分发。
 */
export interface CutoutModelDescriptor {
  id: string;
  name: string;
  /** 固定版本的 ONNX 与 external-data 文件。 */
  files: readonly CutoutModelFileDescriptor[];
  /** 全部模型文件的下载总大小（字节）。 */
  sizeBytes: number;
  /** Encoder 固定输入尺寸。 */
  inputWidth: number;
  inputHeight: number;
  /** Decoder 低分辨率 logits 尺寸。 */
  maskWidth: number;
  maskHeight: number;
  /** 是否是默认推荐档位。 */
  recommended?: boolean;
  /** 简短说明，展示给用户。 */
  description?: string;
}

export interface CutoutModelFileDescriptor {
  /** 固定版本的下载地址。 */
  url: string;
  /** 保存在 appDataDir/models/ 下的原始文件名。 */
  fileName: string;
  /** 文件大小与 SHA-256，用于流式下载后的完整性校验。 */
  sizeBytes: number;
  sha256: string;
}

/** 统一抠图资源包中用于处理 SAM 输出的本地 alpha 优化模型。 */
export interface CutoutRefinerDescriptor {
  id: string;
  name: string;
  /** 固定版本的 ONNX 下载地址。 */
  url: string;
  /** 安装到 appDataDir/models/ 后的文件名。 */
  fileName: string;
  /** ONNX 文件大小与 SHA-256，用于下载完整性校验。 */
  sizeBytes: number;
  sha256: string;
  description: string;
}

export interface CutoutRepairDescriptor {
  id: string;
  name: string;
  url: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  inputWidth: number;
  inputHeight: number;
  description: string;
}

/** 模型在客户端的安装状态。 */
export type CutoutModelStatus = "missing" | "downloading" | "ready" | "error";

/** 图像坐标系下的框选区域（左上角 + 宽高，单位为像素）。 */
export interface CutoutSelectionBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CutoutSelectionBehavior = "extract" | "background";
export type CutoutRelationSource = "auto" | "manual";
export type CutoutBrushOperation = "add" | "restore";
export type CutoutRepairMode = "local" | "cloud";

export interface CutoutBrushPoint {
  x: number;
  y: number;
}

/** 消除笔画始终保存为原图坐标，缩放画布不会改变半径或路径。 */
export interface CutoutRemovalStroke {
  id: string;
  operation: CutoutBrushOperation;
  radius: number;
  smart: boolean;
  points: CutoutBrushPoint[];
}

/** 带分层与背景修复信息的工作区选区。 */
export interface CutoutSelection extends CutoutSelectionBox {
  /** Only used by automatic layering; old cutout history defaults to element. */
  layerKind?: "element" | "text";
  /** Optional closed outline in image coordinates; omitted for rectangular selections. */
  polygon?: CutoutBrushPoint[];
  behavior: CutoutSelectionBehavior;
  parentId: string | null;
  relationSource: CutoutRelationSource;
  removalStrokes: CutoutRemovalStroke[];
}

/** Parent-to-canvas command used for atomic selection replacement and undo. */
export interface CutoutSelectionCommand {
  id: number;
  selections: CutoutSelection[];
}

/** 桌面自动分层页保存的可恢复选区；原图只保存用户选择时的绝对路径。 */
export interface AutoLayerSelectionRecord {
  schemaVersion: 1;
  id: string;
  sourcePath: string;
  sourceName: string;
  sourceMimeType: "image/png" | "image/jpeg" | "image/webp";
  sourceWidth: number;
  sourceHeight: number;
  thumbnailUrl: string;
  selections: CutoutSelection[];
  createdAt: string;
}

/** 图像坐标系下的点提示：label 为 1 表示前景点，0 表示背景点。 */
export interface CutoutPointPrompt {
  x: number;
  y: number;
  label: 0 | 1;
}

/** 单次抠图结果：透明 PNG Blob 及其来源选区。 */
export interface CutoutResult {
  id: string;
  /** 透明背景 PNG。 */
  blob: Blob;
  /** 结果缩略图 DataURL，用于右侧结果区展示。 */
  thumbnailUrl: string;
  /** 输出像素宽高。 */
  width: number;
  height: number;
  /** 来源选区（图像坐标系），便于定位与命名。 */
  sourceBox: CutoutSelectionBox;
  sourceSelectionId: string;
  kind: "foreground" | "background";
  repairMode?: CutoutRepairMode;
  /** 建议文件名（不含扩展名）。 */
  baseName: string;
}

/** 桌面本地抠图历史中的输入图片。 */
export interface CutoutHistorySource {
  /** 用户导入时的原始文件名，仅用于展示和恢复 File。 */
  originalName: string;
  /** 任务目录内由客户端生成的安全文件名。 */
  storedFileName: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  /** 首次云端修复返回的服务端原图素材 ID，用于后续只上传新蒙版。 */
  cloudInputAssetId?: string;
}

/** 桌面本地抠图历史中的单个透明结果。 */
export interface CutoutHistoryAsset {
  id: string;
  /** 任务目录内由客户端生成的安全文件名。 */
  storedFileName: string;
  baseName: string;
  width: number;
  height: number;
  thumbnailUrl: string;
  sourceBox: CutoutSelectionBox;
  sourceSelectionId: string;
  kind: "foreground" | "background";
  repairMode?: CutoutRepairMode;
}

/** 一轮本地 AI 抠图任务；原图和结果二进制保存在 appDataDir。 */
export interface CutoutHistoryRecord {
  schemaVersion: 2;
  id: string;
  mattingId: string;
  source: CutoutHistorySource;
  selections: CutoutSelection[];
  assets: CutoutHistoryAsset[];
  costCredits: number;
  createdAt: string;
}
