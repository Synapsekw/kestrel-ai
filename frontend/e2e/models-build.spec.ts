import { expect, test } from "@playwright/test";
import { MODEL, P, routeAssetModels, routeRuns } from "./fixtures/assetModels";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";

test.use(SWIFTSHADER);

const URL_ = `/p/${P}/models/${MODEL}`;

test("build with AI from a drawing, watch progress, get a version", async ({ page }) => {
  await routeAssetModels(page, { empty: true });
  const runs = await routeRuns(page, { finishAfterPolls: 2 });
  await page.goto(URL_);
  await page.getByRole("button", { name: /build with ai/i }).click();
  await page.getByRole("checkbox", { name: /ga drawing/i }).check();
  await page.getByRole("button", { name: /start build/i }).click();
  await expect(page.getByText(/step \d+ of 80/i).first()).toBeVisible();
  await expect(page.getByText(/built version 1/i)).toBeVisible({ timeout: 15_000 });
  expect(runs.started[0].sources).toEqual([{ type: "drawing", id: "d1" }]);
});

test("stop a run", async ({ page }) => {
  await routeAssetModels(page, { empty: true });
  const runs = await routeRuns(page, { finishAfterPolls: 99 });
  await page.goto(URL_);
  await page.getByRole("button", { name: /build with ai/i }).click();
  await page.getByRole("checkbox", { name: /ga drawing/i }).check();
  await page.getByRole("button", { name: /start build/i }).click();
  await page.getByRole("button", { name: /^stop$/i }).click();
  await expect.poll(() => runs.stopped).toBe(1);
});
