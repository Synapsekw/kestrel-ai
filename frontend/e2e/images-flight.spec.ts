import { test, expect } from "@playwright/test";
import { djiFrames, P, serveImages } from "./images/world";
import { ws } from "./images/ui";
import { entrancesDone, evidencePath } from "./evidence";

// Spec §17 flow 1 and §18 item 1: a 3-frame DJI flight imports; the browser shows it as a grid and
// as a map of 3 capture points with the current frame's footprint; the info chip shows the GSD.
test("a DJI flight imports, maps its 3 capture points and footprint, and shows the GSD", async ({ page }) => {
  const frames = djiFrames();
  const world = await serveImages(page, { frames, imported: false });

  await page.goto(`/p/${P}`);
  await page.getByRole("button", { name: "Add data" }).first().click();
  await page
    .getByRole("dialog", { name: "Add data" })
    .getByRole("button", { name: /Photos/ })
    .click();
  const importer = page.getByRole("dialog", { name: "Import images" });
  await importer.getByLabel("Folder").fill("E:\\Flights\\DJI");
  await importer.getByRole("button", { name: "Start import" }).click();
  await expect.poll(() => world.imported).toBe(true);

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /^Images/ }).click();
  const w = ws(page);
  await expect(w.gridTiles).toHaveCount(3);
  await w.gridTiles.first().click();
  await expect(w.canvas).toHaveAttribute("data-image", "800x600");
  await expect(w.infoChip).toContainText(/GSD\s*69\.1\s*mm\/px/);

  await page.keyboard.press("Shift+M");
  await expect(w.browserView.getByRole("radio", { name: "Map" })).toHaveAttribute("aria-checked", "true");
  await expect(w.captureMap).toHaveAttribute("data-point-count", "3");
  await expect(w.captureMap).toHaveAttribute("data-footprint-kind", "trapezoid");
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("images", "flow1-map.png") });
});
