import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// `pnpm -C frontend e2e:perf`: the Images machine-speed budgets - the frame budget (spec §17 flow 6),
// the capture map's ready time and the 20k index time - alone and on one worker, so they measure
// the app, not a parallel suite. Run it on the dev machine, not in CI (CI renders in software:
// vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md).
export default defineConfig({
  ...base,
  testMatch: /images-(perf|map-scale|scale)\.spec\.ts$/,
  workers: 1,
  retries: 0,
  metadata: { frameBudget: true },
});
