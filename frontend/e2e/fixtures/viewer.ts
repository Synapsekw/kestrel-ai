// frontend/e2e/fixtures/viewer.ts
import { expect, type Page } from "@playwright/test";

/** WebGL on SwiftShader only (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md). */
export const SWIFTSHADER_ARGS = ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"];

export async function viewerStats(page: Page) {
  return page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
}

/** Drawn with nothing left loading (see clouds.spec.ts `viewerSettled` for why 20 s). */
export async function viewerSettled(page: Page) {
  await expect
    .poll(async () => (await viewerStats(page))?.settledMs ?? null, { timeout: 20_000 })
    .not.toBeNull();
  await expect.poll(async () => (await viewerStats(page))?.nodesLoading ?? 1).toBe(0);
}

/** EDL on (SwiftShader makes F's Auto effects reduced, which turns it off: plan Ruling 14). */
export async function edlOn(page: Page) {
  await page.evaluate(() => window.__kestrelCloudViewer!.setEdl(true));
  await expect.poll(() => page.evaluate(() => window.__kestrelCloudViewer!.edl().on)).toBe(true);
}
