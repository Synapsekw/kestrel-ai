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
    // No GL flags here: clouds.spec.ts, the only file that draws WebGL, asks for SwiftShader for
    // WebGL itself. Never `--use-angle=swiftshader`: it puts the compositor on SwiftShader too, and
    // every CSS animation then costs whole cores (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md).
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
      // The built bundle, not `vite dev`: dev serves every source module as its own request (~100
      // per page load, each new browser context on fresh sockets), and on the Windows runner one of
      // them failed with net::ERR_NO_BUFFER_SPACE (/@react-refresh), so the app never booted and
      // the test timed out waiting for the viewer (ci run 36521514150, attempt 2). The bundle is a
      // handful of requests, loads faster on the 4 vCPU runner, and is what the app ships.
      // VITE_MOCK_URL is read at build time, hence the build here rather than reusing `pnpm build`.
      command:
        `pnpm exec vite build --outDir dist-e2e --emptyOutDir --logLevel warn && ` +
        `pnpm exec vite preview --outDir dist-e2e --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { VITE_MOCK_URL: `http://127.0.0.1:${mockPort}` },
    },
  ],
});
