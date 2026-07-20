import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { disableAppContextMenu } from "@/services/desktop";
import { useAppStore } from "@/stores/app";
import "./styles/main.scss";

disableAppContextMenu();

const pinia = createPinia();
const vueApp = createApp(App);
vueApp.use(pinia).use(router);

await useAppStore(pinia).hydrateLocalState();
vueApp.mount("#app");
