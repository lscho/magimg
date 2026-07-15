import { createRouter, createWebHashHistory } from "vue-router";
import GenerateView from "@/views/GenerateView.vue";
import HistoryView from "@/views/HistoryView.vue";
import SettingsView from "@/views/SettingsView.vue";
import TemplateGalleryView from "@/views/TemplateGalleryView.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/generate/text-to-image" },
    { path: "/generate/:mode", component: GenerateView, name: "generate" },
    { path: "/history", component: HistoryView, name: "history" },
    { path: "/templates", component: TemplateGalleryView, name: "templates" },
    { path: "/settings", component: SettingsView, name: "settings" }
  ]
});
