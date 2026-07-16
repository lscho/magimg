import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
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

function apiOrigin(value?: string) {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return value.replace(/\/+$/u, "");
  }
}
