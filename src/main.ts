import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { disableWindowsContextMenu } from "@/services/desktop";
import "./styles/main.scss";

disableWindowsContextMenu();
createApp(App).use(createPinia()).use(router).mount("#app");
