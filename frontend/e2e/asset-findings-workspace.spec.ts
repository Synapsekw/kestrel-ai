// e2e/asset-findings-workspace.spec.ts
import { expect, test } from "@playwright/test";
import { MODEL, P, routeAssetModels } from "./fixtures/assetModels";
import { SOURCE_ID, routeAssetReview } from "./fixtures/assetReviewWorkspace";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";

test.use(SWIFTSHADER);

test("findings and photos topics on the asset model", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await routeAssetModels(page);
  const review = await routeAssetReview(page);
  await page.goto(`/p/${P}/models/${MODEL}`);
  const rail = page.getByRole("toolbar", { name: /model view tools/i });
  await expect(rail).toBeVisible();

  await rail.getByRole("button", { name: /^findings/i }).click();
  const panel = page.getByTestId("rail-panel");
  await expect(panel).toHaveAttribute("data-topic", "findings");
  await panel.getByRole("option", { name: /F-0001/ }).click();
  await expect(panel.getByText("6.2 m", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: /^focus$/i }).click();
  await panel.getByRole("button", { name: /findings actions/i }).click();
  await page.getByRole("menuitem", { name: /^compute placements$/i }).click();
  await expect.poll(() => review.posts).toContain("/placements/compute");

  await rail.getByRole("button", { name: /^photos/i }).click();
  await expect(panel).toHaveAttribute("data-topic", "photos");
  await expect(panel.getByText("2 photos")).toBeVisible(); // the context photo is left out
  await panel.getByRole("switch", { name: /include context photos/i }).click();
  await expect(panel.getByText("3 photos")).toBeVisible();
  await panel.getByRole("button", { name: /photos actions/i }).click();
  await page.getByRole("menuitem", { name: /estimate poses/i }).click();
  await expect.poll(() => review.posts).toContain("/poses/estimate");

  await page.reload();
  await expect(page.getByTestId("rail-panel")).toHaveAttribute("data-topic", "photos"); // remembered
  expect(pageErrors).toEqual([]);
});

test("import an inspection review: dry run, preview, mapping, import", async ({ page }) => {
  await routeAssetModels(page);
  const review = await routeAssetReview(page);
  await page.goto(`/p/${P}/models/${MODEL}`);
  // a fresh browser context opens the rail on the Model topic, where the picker is
  await expect(page.getByTestId("rail-panel")).toHaveAttribute("data-topic", "model");
  await page.getByRole("button", { name: /asset model: /i }).click();
  await page.getByRole("button", { name: /import inspection review/i }).click();
  const dialog = page.getByRole("dialog", { name: /import inspection review/i });
  await dialog.getByLabel(/review job folder/i).fill("D:\\kits\\tower\\job");
  await expect(dialog.getByLabel(/image set with the photos/i)).toHaveValue(SOURCE_ID);
  await dialog.getByRole("button", { name: /check the folder/i }).click();
  const preview = dialog.getByRole("region", { name: /what this import will do/i });
  await expect(preview).toContainText("2 of 3 photos matched");
  await expect(preview).toContainText("3 sightings");
  await preview.getByText(/photos not matched; they are left out/i).click();
  await expect(preview.getByRole("list", { name: /photos not matched/i })).toContainText(
    "No image with this name in the image set",
  );
  await dialog.getByRole("button", { name: /^import$/i }).click();
  await expect(dialog).toBeHidden();
  expect(review.imports.map((b) => b.dry_run)).toEqual([true, false]);
  expect(review.imports[1].class_map).toEqual({ crack: "c1a2b3c4-0000-4000-8000-000000000009" });
});
