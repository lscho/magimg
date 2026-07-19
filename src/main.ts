import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { disableAppContextMenu } from "@/services/desktop";
import "./styles/main.scss";

disableAppContextMenu();
createApp(App).use(createPinia()).use(router).mount("#app");
