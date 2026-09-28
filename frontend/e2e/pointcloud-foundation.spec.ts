import { test, expect } from "@playwright/test";
import { emptyCameras, routeCameras } from "./fixtures/cameras";
import { CLOUD } from "./fixtures/clouds";
import { P, ws } from "./fixtures/cloudWorkspace";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";

// No WebGL flags here: the Prism example cloud is not drawn, only the routes and the workspace
// shell are checked (the canvas test is in clouds.spec.ts).
test("Point clouds opens the full-bleed workspace from the project tabs; Measurements still opens", async ({
  page,
}) => {
  // Prism's own PointCloudOut example (served for /pointclouds, unstubbed) has this same id, so
  // this only supplies what Prism cannot serve meaningfully on its own: a real octree (its binary
  // endpoint has no schema example and Prism's literal "string" placeholder fails to parse, which
  // otherwise sends the viewer straight to its "could not be shown" error and the palette never
  // renders — see docs/evidence/clouds/README.md "Task 3" deviation) and an empty camera set (a
  // real `CloudCameraSet` example draws a frustum/warn-point glyph the workspace-shell check below
  // does not care about).
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  await routeCameras(page, P, emptyCameras());
  await page.goto(`/p/${P}`);
  await page.getByRole("tab", { name: /^Point clouds/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/clouds(/[^/?]+)?$`));
  // The workspace root is full-bleed (no page tabs): CloudWorkspace.tsx still renders an sr-only
  // <h1>Point clouds</h1> (S1's old assertion on the visible heading, kept here on the same text).
  await expect(page.getByRole("heading", { name: "Point clouds" })).toBeAttached();
  const w = ws(page);
  // the Prism mock lists its example cloud, so the workspace opens on it: the palette is there
  await expect(w.palette).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("cloud-workspace")).toBeVisible();
  await expect(w.tool("Orbit")).toHaveAttribute("aria-pressed", "true");

  await page.goto(`/p/${P}`);
  await page.getByRole("tab", { name: /^Measurements/ }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/measurements$`));
  await expect(page.getByRole("heading", { level: 1, name: "Measurements" })).toBeVisible();

  // A deep link with the 3D-jump parameters must land on the workspace, not the router's error
  // page. "c1" is not the Prism mock's own example cloud id (c0000000-8888-4000-8000-000000000001,
  // contract/openapi.yaml PointCloudOut example), so the lookup in CloudWorkspace.tsx misses and it
  // renders MissingCloud's "not in the project" card instead of a ready cloud — the documented
  // fallback for this exact case (task-3-brief.md Step 1). That card is still the workspace route,
  // not the app's router-level not-found page, which is what this assertion is actually checking.
  await page.goto(`/p/${P}/clouds/c1?at=553100.5,2847300.25`);
  await expect(page.getByText("This point cloud is not in the project")).toBeVisible();
});

test("App settings links to About Kestrel AI", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("link", { name: "About Kestrel AI" }).click();
  await expect(page).toHaveURL(/\/about$/);
  await expect(page.getByRole("heading", { name: "About Kestrel AI" })).toBeVisible();
});
