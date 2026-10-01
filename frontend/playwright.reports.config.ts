import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// Reports spec §17 flows 1-4 and the §18 300-finding check against the real FastAPI backend (plan
// 2026-09-30-reports-r10). The shared venv's interpreter runs this checkout's backend on a scratch data
// folder (never %APPDATA%); the UI is the built bundle, as in playwright.config.ts, with
// APP_BACKEND_URL baked in at build time. Opt-in, never part of `pnpm e2e`:
//   pnpm -C frontend e2e:reports                                 flows 1-4
//   $env:E2E_FRAME_BUDGET=1; pnpm -C frontend e2e:reports        also the 300-finding frame budget
const webPort = Number(process.env.E2E_WEB_PORT ?? 5772);
const apiPort = Number(process.env.E2E_API_PORT ?? webPort + 1);
const token = process.env.E2E_API_TOKEN ?? "e2e-reports-token";
const python = process.env.KESTREL_PYTHON ?? "E:\\Dev\\Yolo\\app\\backend\\.venv\\Scripts\\python.exe";
const converter =
  process.env.KESTREL_POTREECONVERTER ??
  "E:\\Dev\\Yolo\\app\\backend\\third_party\\potreeconverter\\PotreeConverter.exe";
const dataDir = process.env.E2E_DATA_DIR ?? join(tmpdir(), `kestrel-e2e-reports-${apiPort}`);
const frameBudget = process.env.E2E_FRAME_BUDGET === "1";

// A worktree has no third_party folder; the cloud import would otherwise fail deep inside a job.
if (!existsSync(converter)) {
  throw new Error(
    `PotreeConverter not found at ${converter}. Run backend\\scripts\\fetch_potreeconverter.ps1 in the main checkout, or set KESTREL_POTREECONVERTER.`,
  );
}

process.env.E2E_REPORTS_BACKEND = "1";
process.env.E2E_API_PORT = String(apiPort);
process.env.E2E_API_TOKEN = token;
process.env.E2E_DATA_DIR = dataDir;
process.env.KESTREL_PYTHON = python;

export default defineConfig({
  testDir: "e2e",
  testMatch: /reports-(real-backend|scale)\.spec\.ts$/,
  timeout: 300_000,
  workers: 1,
  retries: 0,
  // Beside the scratch data, not frontend/test-results: a gate run in the same checkout empties
  // that folder at its start and would take this run's trace with it.
  outputDir: join(dataDir, "test-results"),
  metadata: { frameBudget },
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
        KESTREL_POTREECONVERTER: converter,
      },
    },
    {
      command:
        `pnpm exec vite build --outDir dist-e2e-reports --emptyOutDir --logLevel warn && ` +
        `pnpm exec vite preview --outDir dist-e2e-reports --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { APP_BACKEND_URL: `http://127.0.0.1:${apiPort}`, APP_BACKEND_TOKEN: token },
    },
  ],
});
