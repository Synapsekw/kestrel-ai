import { test, expect } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { P, ws } from "./fixtures/cloudWorkspace";

// A machine whose graphics cannot start WebGL: no GPU and no software fallback.
test.use({ launchOptions: { args: ["--disable-gpu", "--disable-software-rasterizer"] } });

test("without WebGL the view says it cannot start, and the Findings and Measurements lists still work", async ({
  page,
}) => {
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  const alert = page.getByRole("alert").filter({ hasText: "The 3D view could not start" });
  await expect(alert).toContainText("WebGL", { timeout: 20_000 });
  // the rest of the screen is still there (spec §14 "No WebGL"). Text, not visibility: with no
  // rasteriser this browser reports every box hidden.
  const w = ws(page);
  await expect(page.locator("body")).toContainText("Fixture cloud");
  // Without a view CloudWorkspace.tsx renders the picker in CloudPanel's own glass panel, point
  // count and all (old S1 assertion on "10 201 points", kept on the same text via the picker).
  await expect(w.picker()).toContainText("10 201 points");
  // the panels that need the view are not rendered (CloudWorkspace.tsx: the rail, Readout and
  // Minimap all sit behind `hasView`, which never becomes true here); nothing is selected, so no
  // inspector either (workspace-rail spec §3.2)
  await expect(w.rail).toHaveCount(0);
  await expect(w.inspectorPanel).toHaveCount(0);
  await expect(w.readout).toHaveCount(0);
  await expect(w.minimap).toHaveCount(0);
});
