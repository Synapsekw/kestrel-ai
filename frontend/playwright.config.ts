import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:1420", headless: true },
  webServer: [
    {
      command: "pnpm --dir ../contract mock",
      url: "http://127.0.0.1:4010/api/v1/health",
      reuseExistingServer: true,
      timeout: 60_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: "pnpm dev",
      url: "http://127.0.0.1:1420",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
