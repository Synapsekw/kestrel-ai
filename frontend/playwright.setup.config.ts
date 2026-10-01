import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

// Project setup (S1) spec §12 against the real FastAPI backend (plan 2026-09-30-setup-u6, ruling
// U6-4). The shared venv's interpreter runs this checkout's backend on a scratch data folder (never
// %APPDATA%); the UI is the built bundle, as in playwright.config.ts, with APP_BACKEND_URL baked in
// at build time. Opt-in, never part of `pnpm e2e`:
//   pnpm -C frontend e2e:setup
const webPort = Number(process.env.E2E_WEB_PORT ?? 5852);
const apiPort = Number(process.env.E2E_API_PORT ?? webPort + 1);
const token = process.env.E2E_API_TOKEN ?? "e2e-setup-token";
// The shared venv's interpreter: a worktree has no venv of its own (CONTRIBUTING.md), so look for
// backend/.venv from this config's folder upwards. frontend/ -> the checkout's own backend (the main
// checkout), then .claude/worktrees/<name>/ -> .. -> the main checkout's. KESTREL_PYTHON overrides.
function findPython(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, "backend", ".venv", "Scripts", "python.exe");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("backend/.venv not found above the config; set KESTREL_PYTHON");
    dir = parent;
  }
}
const python = process.env.KESTREL_PYTHON ?? findPython();
const dataDir = process.env.E2E_DATA_DIR ?? join(tmpdir(), `kestrel-e2e-setup-${apiPort}`);

process.env.E2E_SETUP_BACKEND = "1";
process.env.E2E_API_PORT = String(apiPort);
process.env.E2E_API_TOKEN = token;
process.env.E2E_DATA_DIR = dataDir;
process.env.KESTREL_PYTHON = python;

export default defineConfig({
  testDir: "e2e",
  testMatch: /setup-real-backend\.spec\.ts$/,
  timeout: 240_000,
  workers: 1,
  retries: 0,
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
      command:
        `pnpm exec vite build --outDir dist-e2e-setup --emptyOutDir --logLevel warn && ` +
        `pnpm exec vite preview --outDir dist-e2e-setup --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { APP_BACKEND_URL: `http://127.0.0.1:${apiPort}`, APP_BACKEND_TOKEN: token },
    },
  ],
});
