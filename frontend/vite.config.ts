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
  // VITE_DEV_PORT moves the dev server (e2e beside another checkout that holds 1420).
  server: { port: Number(process.env.VITE_DEV_PORT ?? 1420), strictPort: true, host: "127.0.0.1" },
  clearScreen: false,
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
