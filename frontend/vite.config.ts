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
  envPrefix: ["VITE_", "APP_"],
  server: { port: 1420, strictPort: true, host: "127.0.0.1" },
  clearScreen: false,
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
