import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";

const CutoutView = () => import("@/views/CutoutView.vue");
const AutoLayerView = () => import("@/views/AutoLayerView.vue");
const GenerateView = () => import("@/views/GenerateView.vue");
const HistoryView = () => import("@/views/HistoryView.vue");
const ImageEditorView = () => import("@/views/ImageEditorView.vue");
const ImageCompressionView = () => import("@/views/ImageCompressionView.vue");
const TemplateGalleryView = () => import("@/views/TemplateGalleryView.vue");

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/generate/text-to-image" },
  { path: "/generate/:mode", component: GenerateView, name: "generate" },
  { path: "/templates", component: TemplateGalleryView, name: "templates" },
  { path: "/editor", component: ImageEditorView, name: "editor" },
  { path: "/cutout", component: CutoutView, name: "cutout" },
  { path: "/auto-layer", component: AutoLayerView, name: "auto-layer" },
  { path: "/compress", component: ImageCompressionView, name: "compress" },
  { path: "/history", component: HistoryView, name: "history" },
  { path: "/settings", redirect: "/generate/text-to-image" }
];

// 调试页面仅在开发模式下注册路由；生产构建不可访问，未知路径回退到生成页。
// 懒加载也包在 DEV 判断内，使调试视图在生产构建中被 tree-shake 掉。
if (import.meta.env.DEV) {
  const CutoutDebugView = () => import("@/views/CutoutDebugView.vue");
  routes.push({ path: "/debug/cutout", component: CutoutDebugView, name: "debug-cutout" });
} else {
  routes.push({ path: "/:pathMatch(.*)*", redirect: "/generate/text-to-image" });
}

export const router = createRouter({
  history: createWebHashHistory(),
  routes
});
