import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { disableAppContextMenu } from "@/services/desktop";
import { useAppStore } from "@/stores/app";
import "./styles/main.scss";

disableAppContextMenu();

const pinia = createPinia();
const regressionMode = import.meta.env.DEV && Boolean(import.meta.env.VITE_AUTO_LAYER_REGRESSION_URL);
const RootComponent = regressionMode
  ? (await import("@/components/auto-layer/AutoLayerRegressionRunner.vue")).default
  : App;
const vueApp = createApp(RootComponent);
vueApp.use(pinia);
if (!regressionMode) vueApp.use(router);

await useAppStore(pinia).hydrateLocalState();
vueApp.mount("#app");
