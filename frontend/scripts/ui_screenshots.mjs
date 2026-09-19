// Screenshots of every screen against the Prism mock, for the site office UI review.
// Start the mock and Vite first (`scripts/dev.ps1 -Mode mock`), then:
//   node scripts/ui_screenshots.mjs [outDir]
// Default outDir: docs/evidence/ui/2026-09-19-site-office (relative to the repo root).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const out = resolve(process.argv[2] ?? join(import.meta.dirname, "../../docs/evidence/ui/2026-09-19-site-office"));
mkdirSync(out, { recursive: true });
const base = "http://127.0.0.1:1420";
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const IMG = "10000000-5555-4000-8000-000000000001";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
// Animations run to their end state before each shot; the running-state shimmer is frozen.
await page.emulateMedia({ reducedMotion: "reduce" });

async function shot(name, url, prepare) {
  if (url) await page.goto(base + url);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(400);
  if (prepare) await prepare();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log("saved", name);
}

await shot("01-projects", "/");
await shot("02-home", `/p/${P}`);
await shot("03-images-grid", `/p/${P}/data`);
await shot("04-images-list-selection", null, async () => {
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByLabel("Select IX-12-02491_0031_0001.jpg").check();
});
await shot("05-import-dialog", `/p/${P}/data`, async () => {
  await page.getByRole("button", { name: "Import images" }).click();
  await page.getByRole("button", { name: /^Advanced settings/ }).click();
});
await shot("06-label", `/p/${P}/edit/${IMG}`);
await shot("07-label-shortcuts", null, async () => {
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
});
await shot("08-review", `/p/${P}/review`);
await shot("09-datasets", `/p/${P}/datasets`, async () => {
  const row = page.getByTestId("dataset-table").getByRole("row").first();
  if (await row.isVisible().catch(() => false)) await row.click();
});
await shot("10-models", `/p/${P}/models`, async () => {
  const name = page.getByRole("button", { name: /^Select model/ }).first();
  if (await name.isVisible().catch(() => false)) await name.click();
});
await shot("11-train", `/p/${P}/train`, async () => {
  await page.getByRole("button", { name: /^More options/ }).click();
});
await shot("12-detect", `/p/${P}/query`);
await shot("13-project-settings", `/p/${P}/settings`);
await shot("14-app-settings", "/settings");
await shot("15-jobs-drawer", `/p/${P}/data`, async () => {
  await page.getByRole("button", { name: /active jobs?$/ }).click();
});
await browser.close();
