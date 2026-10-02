import { expect, test } from "@playwright/test";
import { P, routeAssetModels } from "./fixtures/assetModels";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";

test.use(SWIFTSHADER);

const URL_ = `/p/${P}/models/a0000000-9999-4000-8000-000000000001`;

test("open the asset models tab, see the parts, edit one into a new version", async ({ page }) => {
  const posted = await routeAssetModels(page);
  await page.goto(URL_);
  await expect(page.getByTestId("model-workspace")).toBeVisible();
  // the parts come from the GLB extras
  const n7 = page.getByRole("button", { name: /nozzle n7/i });
  await expect(n7).toBeVisible({ timeout: 20_000 });
  await n7.click();
  await page.getByLabel(/projection/i).fill("250");
  await page.getByRole("button", { name: /save as new version/i }).click();
  await expect(page.getByText(/saved version 3/i)).toBeVisible();
  expect(posted.versions[0].note).toBe("N7: projection 200 → 250 mm");
  expect(posted.versions[0].spec.parts.find((p) => p.id === "N7")?.params.projection).toBe(250);
});

test("no WebGL: the parts list still works", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
  });
  await routeAssetModels(page);
  await page.goto(URL_);
  await expect(page.getByRole("alert")).toContainText(/3D view is off/i);
  await expect(page.getByRole("tab", { name: /parts/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /nozzle n7/i })).toBeVisible();
  await ctx.close();
});
