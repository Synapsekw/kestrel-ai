import { defineConfig } from "@playwright/test";

// Defaults are the dev ports. E2E_WEB_PORT / E2E_MOCK_PORT run the suite on other ports, so a
// worktree can test its own code while another checkout's dev servers hold 1420 and 4010
// (`reuseExistingServer` would otherwise test whatever answers there).
const webPort = Number(process.env.E2E_WEB_PORT ?? 1420);
const mockPort = Number(process.env.E2E_MOCK_PORT ?? 4010);

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  // CI keeps a trace of each failure (uploaded as the playwright-results artifact).
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    headless: true,
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  webServer: [
    {
      command: `pnpm --dir ../contract exec prism mock openapi.yaml --host 127.0.0.1 --port ${mockPort}`,
      url: `http://127.0.0.1:${mockPort}/api/v1/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      ignoreHTTPSErrors: true,
    },
    {
      command: "pnpm dev",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { VITE_DEV_PORT: String(webPort), VITE_MOCK_URL: `http://127.0.0.1:${mockPort}` },
    },
  ],
});
