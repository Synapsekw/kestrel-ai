// e2e/asset-inspect.spec.ts
import { expect, test } from "@playwright/test";
import { MODEL, P, routeAssetModels } from "./fixtures/assetModels";
import { F1, F2, routeAssetInspect } from "./fixtures/assetInspect";
import { SWIFTSHADER_ARGS } from "./fixtures/viewer";

test.use({ launchOptions: { args: SWIFTSHADER_ARGS } });

test("split inspection: overlay, hold to compare, stepping, splitter", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await routeAssetModels(page);
  await routeAssetInspect(page);
  await page.goto(`/p/${P}/models/${MODEL}/inspect?finding=${F1}`);

  const photo = page.getByTestId("inspect-photo");
  await expect(page.getByTestId("image-canvas")).toHaveAttribute("data-image", "4000x3000", { timeout: 15_000 });
  await expect(photo).toHaveAttribute("data-rings", "1");
  await expect(photo).toHaveAttribute("data-overlay", "on");
  await expect(page.getByTestId("inspect-hud")).toContainText("6.2 m");
  await expect(page.getByTestId("inspect-hud")).toContainText("Sighting 1 of 2");

  // hold to compare
  await page.keyboard.down(" ");
  await expect(photo).toHaveAttribute("data-overlay", "off");
  await page.keyboard.up(" ");
  await expect(photo).toHaveAttribute("data-overlay", "on");

  // next sighting: the other photo opens
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("image-canvas")).toHaveAttribute("data-image", "5280x3956");
  await expect(page.getByTestId("inspect-hud")).toContainText("Sighting 2 of 2");

  // next finding, then back
  await page.keyboard.press("j");
  await expect(page).toHaveURL(new RegExp(`finding=${F2}`));
  await page.keyboard.press("k");
  await expect(page).toHaveURL(new RegExp(`finding=${F1}`));

  // the splitter, by keyboard, remembered across a reload
  const sep = page.getByRole("separator", { name: /resize the model and photo panes/i });
  await sep.focus();
  await page.keyboard.press("End");
  await expect(sep).toHaveAttribute("aria-valuenow", "75");
  await page.reload();
  await expect(page.getByRole("separator", { name: /resize the model and photo panes/i })).toHaveAttribute("aria-valuenow", "75");

  // the 3D modes mount without errors
  await page.getByRole("radio", { name: /view from pose/i }).click();
  await expect(page.getByTestId("inspect-right-stage")).toBeVisible();
  await page.getByRole("radio", { name: /^model$/i }).click();
  await expect(page.getByText(/no view presets/i)).toBeVisible();
  expect(pageErrors).toEqual([]);
});
