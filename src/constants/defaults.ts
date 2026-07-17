import type { AppSettings, ImageParams } from "@/types";

export const legacySamplePrompt = "A cinematic fantasy castle on a lake at sunset";

export const sampleImages = [
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=85",
  "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1400&q=85",
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=1400&q=85",
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1400&q=85"
];

export const defaultParams: ImageParams = {
  prompt: "",
  model: "gpt-image-2",
  size: "1024x1024",
  n: 1,
  outputFormat: "png",
  responseFormat: "b64_json",
  background: "auto",
  moderation: "auto",
  outputCompression: 85,
  quality: "auto",
  stream: false,
  partialImages: 0,
  style: "vivid",
  user: "",
  strength: 0.55,
  preserveComposition: true
};

export const defaultSettings: AppSettings = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "https://api.example.com",
  saveDirectory: "",
  autoSave: true,
  defaultParams: { ...defaultParams }
};

export const sizes = [
  "auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840"
] as const;

export const sizePresets = [
  { value: "auto", ratio: "智能", label: "自动选择", shape: "auto" },
  { value: "1024x1024", ratio: "1:1", label: "1024 方图", shape: "square" },
  { value: "1536x1024", ratio: "3:2", label: "1536 横图", shape: "landscape" },
  { value: "1024x1536", ratio: "2:3", label: "1536 竖图", shape: "portrait" },
  { value: "2048x2048", ratio: "1:1", label: "2K 方图", shape: "square" },
  { value: "2048x1152", ratio: "16:9", label: "2K 横图", shape: "wide" },
  { value: "3840x2160", ratio: "16:9", label: "4K 横图", shape: "wide" },
  { value: "2160x3840", ratio: "9:16", label: "4K 竖图", shape: "tall" }
] as const;

export const counts = [1, 2, 4, 8] as const;
export const outputFormats = ["png", "jpeg", "webp"] as const;
export const backgrounds = ["auto", "transparent", "opaque"] as const;
export const qualities = ["auto", "low", "medium", "high"] as const;
