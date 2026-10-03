import { expect, test } from "@playwright/test";
import { MODEL, P, routeAssetModels, routeDrawingIntake, routeRuns } from "./fixtures/assetModels";
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

test("include a drawing file that was never imported, then build from it", async ({ page }) => {
  await routeAssetModels(page, { empty: true });
  const runs = await routeRuns(page, { finishAfterPolls: 2 });
  const intake = await routeDrawingIntake(page);
  await page.goto(URL_);
  await page.getByRole("button", { name: /build with ai/i }).click();
  await expect(page.getByText("T0006.pdf")).toBeVisible();
  await page.getByRole("button", { name: /import and include T0006\.pdf/i }).click();
  await expect(page.getByRole("checkbox", { name: /T0006\.pdf/ })).toBeChecked();
  await expect(page.getByRole("button", { name: /start build/i })).toBeEnabled();
  await page.getByRole("button", { name: /start build/i }).click();
  await expect.poll(() => runs.started.length).toBe(1);
  expect(runs.started[0].sources).toEqual([
    { type: "drawing", id: "n1" },
    { type: "drawing", id: "n2" },
  ]);
  expect(intake.pagesPosted[0]).toMatchObject({ name: "T0006", pages: "all" });
});

test("stop a run", async ({ page }) => {
  await routeAssetModels(page, { empty: true });
  const runs = await routeRuns(page, { finishAfterPolls: 99 });
  await page.goto(URL_);
  await page.getByRole("button", { name: /build with ai/i }).click();
  await page.getByRole("checkbox", { name: /ga drawing/i }).check();
  await page.getByRole("button", { name: /start build/i }).click();
  await page.getByRole("button", { name: /^stop$/i }).click();
  // The run ends in the UI: one toast says why; without a version the centre card gives the reason
  // and offers Try again (the bar then offers only Build with AI…), and Stop is gone.
  await expect(page.getByRole("status").filter({ hasText: "Stopped by you" })).toHaveCount(1);
  const card = page.getByTestId("model-no-version");
  await expect(card).toContainText("Stopped by you");
  await expect(card.getByRole("button", { name: /try again/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /try again/i })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^stop$/i })).toHaveCount(0);
  expect(runs.stopped).toBe(1);
});
