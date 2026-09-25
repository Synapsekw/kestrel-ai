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

const CORS = { "Access-Control-Allow-Origin": "*" };
const job = (state: string, type = "pointcloud_import", result: unknown = null) => ({
  id: "j0000000-9999-4000-8000-000000000001",
  project_id: P,
  type,
  state,
  progress: state === "succeeded" ? 1 : 0.4,
  message: "building the 3D view copy: INDEXING 63 %",
  log_path: "",
  params: {},
  result,
  error: null,
  created_at: "2026-09-24T10:00:00Z",
  started_at: null,
  finished_at: null,
});
const admission = (ok: boolean) => ({
  ok,
  ram_needed_bytes: 9_861_101_344,
  ram_available_bytes: ok ? 30e9 : 4e9,
  disk_needed_bytes: 1,
  disk_available_bytes: 2,
  reason: ok
    ? null
    : "This cloud needs about 9.9 GB of free memory; 4.0 GB is free. Close other programs and try again.",
});

test("import: inspect, a refusal, then an admissible file goes importing then ready", async ({ page }) => {
  let list: unknown[] = [];
  let polls = 0;
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/pointclouds`,
    async (route) => {
      if (route.request().method() === "POST") {
        list = [cloudJson({ status: "importing", job_id: job("running").id })];
        return route.fulfill({
          status: 202,
          contentType: "application/json",
          headers: CORS,
          body: JSON.stringify({ cloud: list[0], job: job("queued") }),
        });
      }
      return route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({ items: list }),
      });
    },
  );
  await page.route(
    (u) => u.pathname.endsWith("/pointclouds/inspect"),
    (route) => {
      const path = (route.request().postDataJSON() as { path: string }).path;
      const big = path.includes("huge");
      return route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({
          path,
          size: 6_200_000_000,
          compressed: false,
          las_version: "1.2",
          point_format: 3,
          point_count: big ? 195_274_656 : 10_201,
          has_rgb: true,
          header_bounds: [0, 0, 0, 1, 1, 1],
          crs_wkt: "x",
          epsg: 32639,
          captured_on: null,
          admission: admission(!big),
        }),
      });
    },
  );
  await page.route(
    (u) => u.pathname.endsWith(`/jobs/${job("running").id}`),
    (route) => {
      polls += 1;
      const done = polls > 1;
      if (done) list = [cloudJson()];
      return route.fulfill({
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify(job(done ? "succeeded" : "running")),
      });
    },
  );
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 2 })),
  );

  await page.goto(`/p/${P}/clouds`);
  await page.getByRole("button", { name: "Import" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("LAS or LAZ file").fill("D:\\clouds\\huge.las");
  await expect(dialog).toContainText(
    "This cloud needs about 9.9 GB of free memory; 4.0 GB is free. Close other programs and try again.",
  );
  await expect(dialog.getByRole("button", { name: "Import" })).toBeDisabled();
  await dialog.getByLabel("LAS or LAZ file").fill("D:\\clouds\\site.laz");
  await expect(dialog).toContainText("10 201 points");
  await dialog.getByRole("button", { name: "Import" }).click();
  const row = page.getByRole("list", { name: "Point clouds" });
  await expect(row).toContainText("importing");
  await expect(row).toContainText("ready", { timeout: 15_000 });
});

test("view: budget and colour switches", async ({ page }) => {
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 2 })),
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await page.getByRole("radio", { name: "View" }).click();
  await page.getByLabel("Point budget").selectOption("8000000");
  expect(await page.evaluate(() => localStorage.getItem("kestrel.clouds.pointBudget"))).toBe("8000000");
  await page.getByRole("radio", { name: "Elevation" }).click();
  await expect(page.getByLabel("Lowest")).toHaveValue("0.02");
  await page.getByRole("button", { name: "Reset" }).click();
});

test("export LAZ ends with a toast that reveals the folder", async ({ page }) => {
  const posts: unknown[] = [];
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 2 })),
  );
  const done = job("succeeded", "pointcloud_export", {
    folder: "exports/2026-09-24_101500",
    laz: "cloud-fixture-cloud.laz",
    files: [],
    point_count: 10_201,
    cloud_id: CLOUD,
  });
  await page.route(
    (u) => u.pathname.endsWith(`/pointclouds/${CLOUD}/exports`),
    (route) => {
      posts.push(route.request().postDataJSON());
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({ job: job("queued", "pointcloud_export") }),
      });
    },
  );
  await page.route(
    (u) => u.pathname.endsWith(`/jobs/${done.id}`),
    (route) => route.fulfill({ contentType: "application/json", headers: CORS, body: JSON.stringify(done) }),
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await page.getByRole("button", { name: "Export LAZ" }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ format: "laz", include_measurements: true });
  await expect(page.getByText("LAZ export finished")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Show folder" })).toBeVisible();
});
