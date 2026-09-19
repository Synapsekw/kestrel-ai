/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_BACKEND_URL?: string;
  readonly APP_BACKEND_TOKEN?: string;
  /** Mock server URL for e2e runs on non-default ports (see playwright.config.ts). */
  readonly VITE_MOCK_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
