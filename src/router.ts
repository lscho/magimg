import { createRouter, createWebHashHistory } from "vue-router";

const CutoutView = () => import("@/views/CutoutView.vue");
const GenerateView = () => import("@/views/GenerateView.vue");
const HistoryView = () => import("@/views/HistoryView.vue");
const ImageEditorView = () => import("@/views/ImageEditorView.vue");
const TemplateGalleryView = () => import("@/views/TemplateGalleryView.vue");

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/generate/text-to-image" },
    { path: "/generate/:mode", component: GenerateView, name: "generate" },
    { path: "/templates", component: TemplateGalleryView, name: "templates" },
    { path: "/editor", component: ImageEditorView, name: "editor" },
    { path: "/cutout", component: CutoutView, name: "cutout" },
    { path: "/history", component: HistoryView, name: "history" },
    { path: "/settings", redirect: "/generate/text-to-image" }
  ]
});
