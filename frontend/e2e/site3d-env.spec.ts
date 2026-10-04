import { expect, test } from "@playwright/test";
import { SWIFTSHADER } from "./fixtures/cloudWorkspace";
import { ENV_GLB, envSceneJson, routeSiteScene, SITE_URL } from "./fixtures/siteScene";

test.use(SWIFTSHADER);

test("the site view puts water and sky over the plant and refuses a cloud in another CRS", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await routeSiteScene(page, { withModel: true, scene: envSceneJson(), glb: ENV_GLB });
  await page.goto(SITE_URL);
  const layers = page.getByRole("region", { name: "Layers" });
  // Index Review Focus 2: a cloud in another CRS is never projected; the view says so.
  await expect(layers.getByText(/^Can't place this cloud/)).toBeVisible({ timeout: 20_000 });
  await expect(layers.getByRole("switch", { name: "Local scan" })).toBeDisabled();
  // Under SwiftShader effects are reduced, so the water row notes "Flat water (reduced effects)".
  await expect(layers.getByRole("switch", { name: "Water" })).toHaveAttribute("aria-checked", "true", {
    timeout: 20_000,
  });
  await expect(layers.getByRole("switch", { name: "Sky" })).toHaveAttribute("aria-checked", "true");
  await expect(layers.getByRole("switch", { name: "Photos" })).toBeDisabled(); // "No posed photos in this project."
  await expect(layers.getByText("No posed photos in this project.")).toBeVisible();
  await expect(layers.getByRole("switch", { name: "Findings" })).toHaveAttribute("aria-checked", "true");
  await expect(layers.getByText("No findings with a map or cloud spot.")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
