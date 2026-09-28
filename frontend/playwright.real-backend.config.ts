import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// The one real-backend flow of spec 2026-09-26-map-workspace §15: the real FastAPI backend (the
// shared venv's interpreter, a scratch data folder, never %APPDATA%) and Vite in APP_BACKEND_URL
// mode. Opt-in, never part of `pnpm e2e`:
//   pnpm -C frontend exec playwright test -c playwright.real-backend.config.ts
const webPort = Number(process.env.E2E_WEB_PORT ?? 1520);
const apiPort = Number(process.env.E2E_API_PORT ?? webPort + 1);
const token = process.env.E2E_API_TOKEN ?? "e2e-real-backend-token";
const python = process.env.KESTREL_PYTHON ?? "E:\\Dev\\Yolo\\app\\backend\\.venv\\Scripts\\python.exe";
const dataDir = process.env.E2E_DATA_DIR ?? join(tmpdir(), `kestrel-e2e-maps-${apiPort}`);

process.env.E2E_REAL_BACKEND = "1";
process.env.E2E_API_PORT = String(apiPort);
process.env.E2E_API_TOKEN = token;
process.env.E2E_DATA_DIR = dataDir;
process.env.KESTREL_PYTHON = python;

export default defineConfig({
  testDir: "e2e",
  testMatch: /maps-real-backend\.spec\.ts$/,
  timeout: 240_000,
  workers: 1,
  // Beside the scratch data, not frontend/test-results: a gate run in the same checkout empties
  // that folder at its start and would take this run's trace with it.
  outputDir: join(dataDir, "test-results"),
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `"${python}" -m app`,
      cwd: "../backend",
      // 401 without a token counts as "up" for Playwright.
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        APP_TOKEN: token,
        APP_PORT: String(apiPort),
        APP_DATA_DIR: join(dataDir, "appdata"),
        APP_CORS_ORIGINS: JSON.stringify([`http://127.0.0.1:${webPort}`]),
      },
    },
    {
      command: "pnpm dev",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_DEV_PORT: String(webPort),
        APP_BACKEND_URL: `http://127.0.0.1:${apiPort}`,
        APP_BACKEND_TOKEN: token,
      },
    },
  ],
});
