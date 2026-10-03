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
  const status = page.getByRole("list", { name: "Layer status" });
  // Index Review Focus 2: a cloud in another CRS is never projected; the view says so.
  await expect(status).toContainText("Local scan: Can't place this cloud", { timeout: 20_000 });
  // Under SwiftShader effects are reduced, so the line reads "Water: shown, Flat water (reduced effects)".
  await expect(status).toContainText("Water: shown", { timeout: 20_000 });
  await expect(status).toContainText("Sky: shown");
  await expect(status).toContainText("Photos: No posed photos in this project.");
  await expect(status).toContainText("Findings: shown, No findings with a map or cloud spot.");
  expect(pageErrors).toEqual([]);
});
