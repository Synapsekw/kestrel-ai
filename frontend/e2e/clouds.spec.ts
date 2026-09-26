import { test, expect, type Page } from "@playwright/test";
import { asDetectionProject } from "./kinds";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import { buildOctree, hollowStack, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";

const P = "7f1c2e3a-1111-4000-8000-000000000001";

// WebGL in headless Chromium needs SwiftShader asked for explicitly (plan decision 13). Only this
// file renders WebGL, so only its workers pay for software GL (playwright.config.ts).
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

async function viewerStats(page: Page) {
  return page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
}

/**
 * The viewer's code has loaded (CloudsScreen -> CloudViewer -> three, potree-core) and it has drawn
 * the cloud with nothing left loading. On the CI runner that code alone took over 5 s to arrive
 * through the dev server, so every wait that needs the viewer allows 20 s. `nodesLoading === 0` on
 * its own is no such signal: the hook reports 0 from the first frame, before the octree is even asked
 * for, and a pick made then hits nothing.
 */
async function viewerSettled(page: Page) {
  await expect
    .poll(async () => (await viewerStats(page))?.settledMs ?? null, { timeout: 20_000 })
    .not.toBeNull();
  await expect.poll(async () => (await viewerStats(page))?.nodesLoading ?? 1).toBe(0);
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
  // The octree is asked for only once the viewer's code has loaded (see viewerSettled): on the CI
  // runner that was still arriving 5 s after the page loaded, before any octree request was made.
  await expect(page.getByRole("alert")).toContainText("the 3D view copy is missing; import the file again", {
    timeout: 20_000,
  });
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
  // The job finishes only after the test has seen the row importing: finishing on a poll count let
  // a slow page fetch the list after the job had already succeeded, so "importing" was never shown.
  let importingSeen = false;
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
      const done = importingSeen;
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
  importingSeen = true;
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

test("measure a distance with two picks, save it, copy the CSV", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const saved: unknown[] = [];
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson()] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson());
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
  await page.route(
    (u) => u.pathname.endsWith(`/pointclouds/${CLOUD}/measurements`),
    async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { kind: string; points: unknown[] };
        const m = {
          id: `m${saved.length + 1}`,
          point_cloud_id: CLOUD,
          kind: body.kind,
          name: `Distance ${saved.length + 1}`,
          note: null,
          points: body.points,
          results: { distance_3d: 12.5, uncertainty_m: 0.04 },
          created_at: "2026-09-24T10:00:00Z",
          updated_at: "2026-09-24T10:00:00Z",
        };
        saved.push(m);
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify(m),
        });
      }
      return route.fulfill({
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ items: saved }),
      });
    },
  );
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  await page.getByRole("radio", { name: "Measure" }).click();
  await page.getByRole("button", { name: "Distance" }).click();
  const box = (await page.getByTestId("cloud-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2 + 80, box.y + box.height / 2);
  await expect(page.getByText("3D distance")).toBeVisible();
  await expect(page.getByTestId("pick-readout")).toContainText("EPSG:32639");
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.overlays())).toContain("measure");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page
      .getByRole("list", { name: "Saved measurements" })
      .getByRole("textbox", { name: "Name of Distance 1" }),
  ).toHaveValue("Distance 1");
  await page.getByRole("button", { name: "Copy all as CSV" }).click();
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  expect(csv.split("\r\n")[0]).toBe(
    "id,name,kind,note,x1,y1,z1,u1,x2,y2,z2,u2,lon,lat,dx,dy,dz,distance_3d,distance_horizontal,distance_vertical,height_difference,lean_offset_m,lean_angle_deg,lean_azimuth_deg,lean_mm_per_m,uncertainty_m,angle_uncertainty_deg",
  );
});

const MAP = "a0000000-6666-4000-8000-000000000009";
const RUN = "r0000000-7777-4000-8000-000000000009";
const EXC = "c1a2b3c4-0000-4000-8000-000000000001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==",
  "base64",
);
const siteMap = {
  id: MAP,
  name: "Chimney ortho",
  status: "ready",
  error: null,
  source_path: "D:/orthos/chimney.tif",
  source_size: 1,
  width: 2000,
  height: 2000,
  band_count: 3,
  dtype: "uint8",
  crs_wkt: 'PROJCRS["WGS 84 / UTM zone 39N"]',
  epsg: 32639,
  proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
  geotransform: [243500, 0.05, 0, 3178100, 0, -0.05],
  bounds_native: [243500, 3178000, 243600, 3178100],
  bounds_wgs84: [48.3744, 28.7038, 48.3755, 28.7048],
  gsd_cm: 5,
  tile_grid: { tile_size: 256, max_zoom: 3 },
  labels_version: 0,
  job_id: null,
  created_at: "2026-09-24T09:00:00Z",
  captured_on: "2026-05-04",
};
const siteRun = {
  id: RUN,
  map_id: MAP,
  kind: "local_model",
  model_id: "m0000000-2222-4000-8000-000000000001",
  provider: null,
  model_name: "machinery-v3",
  query: "",
  tile_size: 1280,
  overlap: 0.2,
  nms_iou: 0.5,
  conf: 0.25,
  target_gsd_cm: null,
  job_id: null,
  state: "succeeded",
  counts: { [EXC]: 1 },
  detection_count: 1,
  created_at: "2026-09-24T10:00:00Z",
};

async function mapRoutes(page: Page) {
  const cors = { "Access-Control-Allow-Origin": "*" };
  const j = (pattern: (u: URL) => boolean, body: unknown) =>
    page.route(pattern, (r) =>
      r.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify(body) }),
    );
  await page.route(
    (u) => u.pathname.includes(`/maps/${MAP}/tiles/`),
    (r) => r.fulfill({ contentType: "image/png", headers: cors, body: PNG }),
  );
  await j((u) => u.pathname === `/api/v1/projects/${P}/maps`, { items: [siteMap] });
  await j((u) => u.pathname.endsWith(`/maps/${MAP}/runs`), { items: [siteRun] });
  await j((u) => u.pathname.endsWith(`/maps/${MAP}/labels`), { items: [] });
  await j((u) => u.pathname.endsWith(`/maps/${MAP}/zones`), { items: [] });
  await j((u) => u.pathname.endsWith("/density"), {
    cell_size: 2000,
    cells: [{ gx: 0, gy: 0, class_id: EXC, count: 1 }],
  });
  // one big detection over the middle of the map: a click at the canvas centre lands on it
  await j((u) => u.pathname.endsWith("/detections"), {
    items: [{ id: "d1", class_id: EXC, confidence: 0.9, x: 900, y: 900, w: 200, h: 200, angle: null }],
    truncated: false,
  });
  await j((u) => u.pathname === `/api/v1/projects/${P}/pointclouds`, { items: [cloudJson({ map_id: MAP })] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloudJson({ map_id: MAP }));
  await routeOctree(
    page,
    CLOUD,
    buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 1 })),
  );
}

test("a detection on the map opens the same spot in 3D, and a pick goes back to the map", async ({
  page,
}) => {
  await mapRoutes(page);
  await page.goto(`/p/${P}/maps/${MAP}`);
  await page.getByRole("checkbox", { name: /Show machinery-v3/ }).check();
  const mapBox = (await page.getByTestId("map-view").boundingBox())!;
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.getByRole("button", { name: "Open in 3D" }).click();
  // box centre (1000, 1000) px -> 243500 + 1000 * 0.05, 3178100 - 1000 * 0.05
  await expect(page).toHaveURL(
    new RegExp(`/p/${P}/clouds/${CLOUD}\\?at=243550\\.000,3178050\\.000&fp=243545\\.000,3178055\\.000;`),
  );
  await expect
    .poll(() => page.evaluate(() => window.__kestrelCloudViewer?.overlays() ?? []), { timeout: 20_000 })
    .toContain("pin");
  // Polled: the pin can appear a frame before the view that `lookAt` set has been drawn.
  // 3 m, not 2: this fixture's single level-0 node (0.78 m spacing) draws splats large enough at the
  // 42 m arrival distance that a nearer point covers the centre pixel (measured 2.24 m off). A wrong
  // CRS or axis would miss by hundreds of metres, so 3 m still proves the jump landed on the spot.
  await expect
    .poll(async () => {
      const pick = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
      return pick ? Math.hypot(pick.x - 243550, pick.y - 3178050) : Infinity;
    })
    .toBeLessThan(3);

  // the refine: a hit along the pin within 2 m retargets Z and draws the detection's footprint
  await expect
    .poll(() => page.evaluate(() => window.__kestrelCloudViewer?.overlays() ?? []), { timeout: 20_000 })
    .toContain("footprint");
  // The refine's straight-down pick (final review F2) lands on the spot itself, not a splat 2 m off,
  // and on the surface there: the grid point (243550, 3178050) at z = 0.02 x 50 = 1.0.
  const down = await page.evaluate(() => window.__kestrelCloudViewer!.pickDown(243550, 3178050, 2));
  expect(down).not.toBeNull();
  expect(Math.hypot(down!.x - 243550, down!.y - 3178050)).toBeLessThan(0.5);
  expect(down!.z).toBeCloseTo(1.0, 1);

  const canvas = (await page.getByTestId("cloud-canvas").boundingBox())!;
  await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await page.getByRole("button", { name: "Show on map" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps/${MAP}\\?at=243`));
  await expect(page.getByTestId("map-at-marker")).toBeVisible();
});

test("arriving at a spot on a thin rim refines Z to the rim, not the flue floor seen past it", async ({
  page,
}) => {
  // §17.10 first acceptance: at a chimney rim point (z 188.8) the straight-down refine returned the
  // flue bottom (z -41.6), the drawn point nearest the spot, so the close-up framed the wrong height.
  const C = { x: 243550, y: 3178050 };
  const stack = hollowStack({ centre: [C.x, C.y], top: 5, floor: -2 });
  const bounds = [C.x - 3, C.y - 3, -2, C.x + 3, C.y + 3, 5];
  const cloud = cloudJson({ bounds_native: bounds, point_count: stack.length });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds`, { items: [cloud] });
  await jsonRoute(page, `/api/v1/projects/${P}/pointclouds/${CLOUD}`, cloud);
  await routeOctree(page, CLOUD, buildOctree(stack));
  // on the rim circle, 5° (0.13 m) from the rim point at 0°
  const a = (5 * Math.PI) / 180;
  const spot = { x: C.x + 1.5 * Math.cos(a), y: C.y + 1.5 * Math.sin(a) };
  await page.goto(`/p/${P}/clouds/${CLOUD}?at=${spot.x.toFixed(3)},${spot.y.toFixed(3)}`);
  await expect
    .poll(() => page.evaluate(() => window.__kestrelCloudViewer?.overlays() ?? []), { timeout: 20_000 })
    .toContain("pin");
  await viewerSettled(page);
  const down = await page.evaluate(
    ([x, y]) => window.__kestrelCloudViewer!.pickDown(x, y, 2),
    [spot.x, spot.y],
  );
  expect(down).not.toBeNull();
  expect(down!.z).toBeCloseTo(5, 2);
  expect(Math.hypot(down!.x - spot.x, down!.y - spot.y)).toBeLessThan(0.5); // the rim point beside it
});

test("right-click on the map opens that spot in 3D; a spot outside the cloud says so", async ({ page }) => {
  await mapRoutes(page);
  await page.goto(`/p/${P}/maps/${MAP}`);
  const mapBox = (await page.getByTestId("map-view").boundingBox())!;
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2, { button: "right" });
  await page.getByRole("menuitem", { name: "Open this spot in 3D" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/clouds/${CLOUD}\\?at=`));
  await page.goto(`/p/${P}/clouds/${CLOUD}?at=100.000,200.000`);
  await expect(page.getByText("This spot is outside the cloud")).toBeVisible({ timeout: 20_000 });
});
