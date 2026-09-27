import { test, expect } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

// A machine whose graphics cannot start WebGL: no GPU and no software fallback.
test.use({ launchOptions: { args: ["--disable-gpu", "--disable-software-rasterizer"] } });

test("without WebGL the 3D view says it cannot start and the screen stays usable", async ({ page }) => {
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  // the alert can only appear once the viewer's code has loaded: the same budget as clouds.spec.ts
  const alert = page.getByRole("alert").filter({ hasText: "The 3D view could not start" });
  await expect(alert).toContainText("WebGL", { timeout: 20_000 });
  // The rest of the workspace is still there (spec §14): the picker, Details and the inspector's
  // lists. Text and counts, not visibility: with no rasteriser this browser reports every box hidden.
  const panel = page.getByTestId("cloud-panel");
  await expect(panel).toContainText("Fixture cloud");
  await expect(panel).toContainText("10 201 points");
  await expect(page.getByRole("tab", { name: /Findings/ })).toHaveCount(1);
  await expect(page.getByRole("toolbar", { name: "Point cloud tools" })).toHaveCount(0);
  await expect(page.getByTestId("cloud-readout")).toHaveCount(0);
  await expect(page.getByTestId("cloud-minimap")).toHaveCount(0);
});
