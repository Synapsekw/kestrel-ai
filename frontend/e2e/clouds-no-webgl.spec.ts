import { test, expect } from "@playwright/test";
import { asDetectionProject } from "./kinds";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

// A machine whose graphics cannot start WebGL: no GPU and no software fallback.
test.use({ launchOptions: { args: ["--disable-gpu", "--disable-software-rasterizer"] } });

test("without WebGL the 3D view says it cannot start and the screen stays usable", async ({ page }) => {
  await asDetectionProject(page, P);
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  // the alert can only appear once the viewer's code has loaded: the same budget as clouds.spec.ts
  const alert = page.getByRole("alert").filter({ hasText: "The 3D view could not start" });
  await expect(alert).toContainText("WebGL", { timeout: 20_000 });
  // the rest of the screen is still there (before the fix, the throw replaced it with the router's
  // error page); text, not visibility: with no rasteriser at all this browser reports every box hidden
  const panel = page.getByRole("complementary");
  await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Fixture cloud");
  await expect(panel).toContainText("10 201 points");
});
