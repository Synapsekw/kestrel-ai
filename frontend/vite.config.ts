/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@contract/client": path.resolve(__dirname, "../contract/client"),
      // the generated client lives outside this package, so point its one runtime
      // dependency at the copy installed here
      "openapi-fetch": path.resolve(__dirname, "node_modules/openapi-fetch"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  // The Clouds screen is lazy, so a dev server whose cache predates three/potree-core would find
  // them mid-session and reload the page once; pre-bundling them up front avoids that.
  optimizeDeps: { include: ["three", "potree-core"] },
  envPrefix: ["VITE_", "APP_"],
  // Fonts ship as files: the packaged CSP (default-src 'self') blocks data: fonts.
  build: {
    assetsInlineLimit: (file: string) => (file.endsWith(".woff2") || file.endsWith(".woff") ? false : undefined),
  },
  // VITE_DEV_PORT moves the dev server (e2e beside another checkout that holds 1420).
  server: {
    port: Number(process.env.VITE_DEV_PORT ?? 1420),
    strictPort: true,
    host: "127.0.0.1",
    // src-tauri holds the Rust build (target/) and the frozen sidecar (binaries/_internal): ~50 000
    // files the UI never imports, which the watcher would otherwise crawl at every start.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  clearScreen: false,
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
