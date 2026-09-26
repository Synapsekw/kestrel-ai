// Screenshots every gallery section at full and reduced effects for the visual check (DS plan).
// Needs the dev server: pnpm -C frontend dev. Usage: node scripts/gallery-shots.mjs [section-id]
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = process.env.GALLERY_URL ?? "http://127.0.0.1:1420/gallery.html";
const out = fileURLToPath(new URL("../../docs/evidence/foundation-ds/", import.meta.url));
const only = process.argv[2];
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
for (const effects of ["full", "reduced"]) {
  await page.goto(`${base}?effects=${effects}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
  );
  console.log(`${effects}: loaded fonts ${[...new Set(fonts)].join(", ") || "(none)"}`);
  const ids = await page.$$eval("section[id]", (els) => els.map((e) => e.id));
  for (const id of ids) {
    if (only && id !== only) continue;
    const path = `${out}${id}-${effects}.png`;
    await page.locator(`#${id}`).screenshot({ path, animations: "disabled" });
    console.log(`saved ${path}`);
  }
}
await browser.close();
