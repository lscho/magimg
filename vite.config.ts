import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  if (command === "build" && mode === "production") validateProductionEnv(env);
  const apiTarget = apiOrigin(env.VITE_API_BASE_URL);
  const proxy = apiTarget
    ? {
        "/api/client/v1": { target: apiTarget, changeOrigin: true },
        "/images": { target: apiTarget, changeOrigin: true },
        "/uploads": { target: apiTarget, changeOrigin: true }
      }
    : undefined;

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      proxy
    },
    envPrefix: ["VITE_", "TAURI_"],
    build: {
      target: ["es2022", "chrome120", "safari17"],
      minify: "esbuild"
    }
  };
});

function validateProductionEnv(env: Record<string, string>) {
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim();
  if (!apiBaseUrl) throw new Error(".env.production 缺少 VITE_API_BASE_URL");

  let parsedApiBaseUrl: URL;
  try {
    parsedApiBaseUrl = new URL(apiBaseUrl);
  } catch {
    throw new Error(".env.production 中的 VITE_API_BASE_URL 不是有效 URL");
  }
  if (parsedApiBaseUrl.protocol !== "https:") {
    throw new Error(".env.production 中的 VITE_API_BASE_URL 必须使用 HTTPS");
  }

}

function apiOrigin(value?: string) {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/u, "");
  }
}
