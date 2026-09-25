import { test, expect, type Page } from "@playwright/test";
import { asDetectionProject } from "./kinds";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { buildOctree, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

async function viewerStats(page: Page) {
  return page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
}

/** The fixture cloud, and a list holding only it: the mock's example cloud has other bounds. */
async function routeCloud(page: Page) {
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
}

test.beforeEach(async ({ page }) => {
  await asDetectionProject(page, P);
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
});

test("the viewer renders the cloud and its canvas fills the centre", async ({ page }) => {
  const files = buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 }));
  await routeCloud(page);
  const served = await routeOctree(page, CLOUD, files);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await expect
    .poll(async () => (await viewerStats(page))?.numVisiblePoints ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect.poll(async () => (await viewerStats(page))?.nodesLoading ?? 1).toBe(0);
  expect(served).toContain("hierarchy.bin bytes=0-21");
  const centre = await page.getByTestId("cloud-centre").boundingBox();
  const canvas = await page.getByTestId("cloud-canvas").boundingBox();
  expect(canvas).toEqual(centre);
  const colours = await page.evaluate(() => window.__kestrelCloudViewer!.sampleColours());
  expect(colours.red / colours.total).toBeGreaterThan(0.01);
  expect(colours.green / colours.total).toBeGreaterThan(0.01);
  expect(colours.white).toBe(0);
  const pick = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
  expect(pick).not.toBeNull();
  expect(pick!.x).toBeGreaterThan(243500);
  expect(pick!.uncertainty_m).toBeGreaterThan(0);
});

test("a missing 3D view copy says so instead of a blank canvas", async ({ page }) => {
  await routeCloud(page);
  await page.route(
    (u) => u.pathname.includes(`/pointclouds/${CLOUD}/octree/`),
    (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          error: {
            code: "octree_missing",
            message: "the 3D view copy is missing; import the file again",
            details: {},
          },
        }),
      }),
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await expect(page.getByRole("alert")).toContainText("the 3D view copy is missing; import the file again");
});
