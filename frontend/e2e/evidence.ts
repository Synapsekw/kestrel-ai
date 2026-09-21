import { test } from "@playwright/test";

/**
 * Where an evidence screenshot goes. Ordinary runs (the gate, CI) write into the test's own output
 * folder so they never rewrite tracked files; `E2E_CAPTURE_EVIDENCE=1` refreshes the committed copy
 * under docs/evidence/<folder>/.
 */
export function evidencePath(folder: string, file: string): string {
  if (process.env.E2E_CAPTURE_EVIDENCE === "1") return `../docs/evidence/${folder}/${file}`;
  return test.info().outputPath(file);
}
