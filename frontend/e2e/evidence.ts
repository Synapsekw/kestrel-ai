import { test, type Page } from "@playwright/test";

/**
 * Where an evidence screenshot goes. Ordinary runs (the gate, CI) write into the test's own output
 * folder so they never rewrite tracked files; `E2E_CAPTURE_EVIDENCE=1` refreshes the committed copy
 * under docs/evidence/<folder>/.
 */
export function evidencePath(folder: string, file: string): string {
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") return `../docs/evidence/${folder}/${file}`;
  return test.info().outputPath(file);
}

/**
 * Waits for the entrances to finish before an evidence screenshot (ADR 2026-09-21 measuring animated
 * drawers). Looping animations (a running job's live dot or progress shimmer) are not waited on: they
 * run for as long as the job does.
 */
export async function entrancesDone(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
  );
}
