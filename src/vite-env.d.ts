/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENABLE_UPDATER?: string;
  readonly VITE_AUTO_LAYER_REGRESSION_URL?: string;
  readonly VITE_AUTO_LAYER_REGRESSION_RECORD_ID?: string;
  readonly VITE_AUTO_LAYER_REGRESSION_CLOUD?: string;
  readonly VITE_AUTO_LAYER_REGRESSION_RUN_ID?: string;
  readonly VITE_AUTO_LAYER_REGRESSION_CASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
