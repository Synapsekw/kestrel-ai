/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly APP_BACKEND_URL?: string;
  readonly APP_BACKEND_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
