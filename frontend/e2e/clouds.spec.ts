import { test, expect, type Page, type Request } from "@playwright/test";
import { CLOUD, cloudJson, jsonRoute } from "./fixtures/clouds";
import {
  clickSite,
  enableDiagnostics,
  serveMapWorkspace,
  sitePixel,
  untilSelectable,
} from "./fixtures/mapWorkspace";
import { buildOctree, hollowStack, redGreenGrid, routeOctree } from "./fixtures/potreeOctree";
import {
  P,
  SWIFTSHADER,
  clickCanvas,
  countFrames,
  diagnosticsOn,
  runningAnimations,
  viewerSettled,
  viewerStats,
  ws,
} from "./fixtures/cloudWorkspace";
import { serveCloudWorld } from "./fixtures/cloudWorld";

// S1's point-cloud flows on C's full-bleed workspace (C-G Task 2). WebGL runs on SwiftShader for
// WebGL only (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md); every wait that needs
// the viewer allows 20 s, the time its code took to arrive through the dev server on the CI runner.
// Cameras are always routed empty (C-L1's `emptyCameras`, through `serveCloudWorld`) wherever a test
// opens a cloud without caring about cameras: the Prism example set draws a frustum and a warn-point
// glyph that can land a stray frame in an idle check or a stray point in a colour sample.
test.use(SWIFTSHADER);
test.beforeEach(async ({ page }) => diagnosticsOn(page));

const CORS = { "Access-Control-Allow-Origin": "*" };
const grid = (step = 1) => buildOctree(redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step }));

/**
 * The page's network: requests sent and not yet answered, and when that last changed. A workspace
 * fetch that answers late wakes the render loop (C-L1's cameras layer calls setOverlay, which asks
 * for a frame, even for an empty set), so an idle window may start only once the network is quiet.
 */
function trackNetwork(page: Page) {
  const net = { open: new Set<Request>(), lastChange: Date.now() };
  const on = (r: Request) => {
    net.open.add(r);
    net.lastChange = Date.now();
  };
  const off = (r: Request) => {
    net.open.delete(r);
    net.lastChange = Date.now();
  };
  page.on("request", on);
  page.on("requestfinished", off);
  page.on("requestfailed", off);
  return net;
}

/** Spec §18: EDL moves the cloud to layer 1 and S1's picks must still work with it on. SwiftShader
 * makes Auto effects reduced, so it is forced on (plan Ruling 14), as S1's own settle helper did. */
async function edlOn(page: Page) {
  await page.evaluate(() => window.__kestrelCloudViewer!.setEdl(true));
}

test("WebGL runs on SwiftShader, but the page's own compositing and raster do not", async ({ browser }) => {
  // `--use-angle=swiftshader` moved Chromium's compositor and raster onto SwiftShader as well: every
  // repaint of a CSS animation (the importing row's shimmer, a live pill) then went through a
  // software GPU that takes every core. Measured on the 4-vCPU runner: the GPU process at 399 % while
  // the viewer loaded and ~200 % with nothing but CSS animating, against 98 % and 29 % with
  // compositing left in plain software (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md).
  const cdp = await browser.newBrowserCDPSession();
  const info = (await cdp.send("SystemInfo.getInfo")) as {
    gpu: { featureStatus: Record<string, string>; auxAttributes: Record<string, unknown> };
  };
  await cdp.detach();
  const glRenderer = String(info.gpu.auxAttributes.glRenderer ?? "");
  // GPU compositing on a real GPU is fine; on SwiftShader it is the CPU sink this file must not ask
  // for. (WebGL itself working is what the next test's colour sample proves.)
  expect(
    { glRenderer, gpuCompositing: info.gpu.featureStatus.gpu_compositing },
    "the compositor must not run on SwiftShader",
  ).not.toEqual({ glRenderer: expect.stringContaining("SwiftShader"), gpuCompositing: "enabled" });
});

test("the workspace draws the cloud full-bleed, picks it, and stops rendering once settled", async ({
  page,
}) => {
  const frames = await countFrames(page);
  const net = trackNetwork(page);
  await serveCloudWorld(page);
  // routed again (the later route wins) only to read back the requests it served
  const served = await routeOctree(page, CLOUD, grid());
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  expect(await frames(), "frames were counted while the cloud loaded").toBeGreaterThan(0);
  await edlOn(page);
  expect(await page.evaluate(() => window.__kestrelCloudViewer!.edl())).toEqual({
    on: true,
    rendersToTarget: false,
  });
  expect(served).toContain("hierarchy.bin bytes=0-21"); // S1's Range read of the hierarchy is unchanged
  const w = ws(page);
  expect(await w.canvas.boundingBox()).toEqual(await w.viewport.boundingBox());
  // full-bleed (spec §6): the viewport runs from the app's side rail to the window's right and bottom
  // edges. Full-bleed: the sidebar opens collapsed here (spec 2026-10-03-sidebar §4).
  const vp = (await w.viewport.boundingBox())!;
  const win = page.viewportSize()!;
  expect([vp.x + vp.width, vp.y + vp.height]).toEqual([win.width, win.height]);
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toHaveAttribute("data-state", "collapsed");
  const colours = await page.evaluate(() => window.__kestrelCloudViewer!.sampleColours());
  expect(colours.red / colours.total).toBeGreaterThan(0.01);
  expect(colours.green / colours.total).toBeGreaterThan(0.01);
  expect(colours.white).toBe(0);
  const pick = await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter());
  expect(pick).not.toBeNull();
  expect(pick!.x).toBeGreaterThan(243500);
  expect(pick!.uncertainty_m).toBeGreaterThan(0);
  await page.mouse.move(0, 0); // no hover pick keeps the loop alive
  // Settled and untouched: the loop stops (idle.ts) and no CSS animation runs, the pins layer
  // included. S1 waited a fixed 1.2 s here and flaked once under batch load: a workspace fetch that
  // answers late wakes the loop for IDLE_AFTER_MS (1 s) — a cameras answer held back into that window
  // put 44 frames in it. So the window opens on a real condition instead: nothing in flight and no
  // request sent or answered for IDLE_AFTER_MS plus a margin, so every wake-up has run its course —
  // and the loop itself has stopped. The network alone was not enough (C-G final review C1): setEdl
  // above also asks for a frame, which keeps the loop IDLE_AFTER_MS; when the network had gone quiet
  // before it, the window opened on the loop's own tail (20-47 frames, every stack engine.ts `tick`).
  await expect
    .poll(
      async () =>
        net.open.size === 0 &&
        Date.now() - net.lastChange >= 1_200 &&
        (await viewerStats(page))?.idle === true,
      {
        message: "the network is quiet for IDLE_AFTER_MS + 200 ms and the render loop has stopped",
        timeout: 20_000,
      },
    )
    .toBe(true);
  const before = await frames();
  await page.waitForTimeout(1_000);
  expect(await frames()).toBe(before);
  expect(await runningAnimations(page)).toEqual([]);
});

test("a missing 3D view copy says so instead of a blank canvas", async ({ page }) => {
  await serveCloudWorld(page);
  await page.route(
    (u) => u.pathname.includes(`/pointclouds/${CLOUD}/octree/`),
    (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        headers: CORS,
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

test("import from the empty workspace: a refusal, then an admissible file goes importing then ready", async ({
  page,
}) => {
  let list: unknown[] = [];
  // The job finishes only after the test has seen the card importing: finishing on a poll count let
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
  await routeOctree(page, CLOUD, grid(2));

  await page.goto(`/p/${P}/clouds`);
  // A first load, 15 s like the suite's other first loads: on a slow CI runner (run 36458626779) the
  // dev server's ~900 modules for the clouds screen took 9.5 s to arrive in a fresh context.
  await expect(page.getByText("Import a LAS or LAZ point cloud")).toBeVisible({ timeout: 15_000 }); // S1's empty-state copy
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("LAS or LAZ file").fill("D:\\clouds\\huge.las");
  await expect(dialog).toContainText(
    "This cloud needs about 9.9 GB of free memory; 4.0 GB is free. Close other programs and try again.",
  );
  await expect(dialog.getByRole("button", { name: "Import" })).toBeDisabled();
  await dialog.getByLabel("LAS or LAZ file").fill("D:\\clouds\\site.laz");
  await expect(dialog).toContainText("10 201 points");
  await dialog.getByRole("button", { name: "Import" }).click();
  // the importing cloud is a centred glass card with the job's progress (spec §6, non-ready states)
  await expect(page.getByTestId("cloud-importing")).toContainText("Building the 3D view copy…");
  importingSeen = true;
  await expect(ws(page).rail).toBeVisible({ timeout: 20_000 });
  await ws(page).openTopic("Layers"); // the picker lives in the Layers topic (workspace-rail spec §3.2)
  await expect(ws(page).picker()).toBeVisible();
});

test("cloud panel: the point budget is remembered and Elevation shows its range", async ({ page }) => {
  await serveCloudWorld(page, { octree: grid(2) });
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  const w = ws(page);
  await w.openTopic("Layers");
  await w.budget.focus();
  await w.budget.press("End"); // the last stop: 8 M
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("kestrel.clouds.pointBudget")))
    .toBe("8000000");
  await w.colour("Elevation").click();
  await expect(w.colour("Elevation")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("Lowest")).toHaveValue("0.02"); // the cloud's p1
  await expect(page.getByText("0.0 m", { exact: true })).toBeVisible(); // the ramp's range in metres
  await expect(page.getByText("2.0 m", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByLabel("Lowest")).toHaveValue("0.02");
  await w.colour("RGB").click();
  await expect(page.getByText("True colour")).toBeVisible();
});

test("export LAZ from the Details dialog ends with a toast that reveals the folder", async ({ page }) => {
  const posts: unknown[] = [];
  await serveCloudWorld(page, { octree: grid(2) });
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
  await ws(page).openTopic("Layers");
  await ws(page).picker().click();
  await page.getByRole("button", { name: "Details…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Export LAZ" }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ format: "laz", include_measurements: true });
  await expect(page.getByText("LAZ export finished")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Show folder" })).toBeVisible();
});

test("measure a distance with two picks, save it with Enter, copy the CSV", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const world = await serveCloudWorld(page);
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  const w = ws(page);
  await page.keyboard.press("l");
  await expect(w.tool("Distance")).toHaveAttribute("aria-pressed", "true");
  await clickCanvas(page, 0, 0);
  await clickCanvas(page, 80, 0);
  await expect(w.hint).toContainText(/\d+(\.\d+)?\s*(m|cm|mm)\b/); // the live result
  await expect(w.readout).toContainText("EPSG:32639");
  await page.keyboard.press("Enter");
  await expect.poll(() => world.measurementPosts.length).toBe(1);
  expect(world.measurementPosts[0]).toMatchObject({ kind: "distance" });
  expect((world.measurementPosts[0] as { points: unknown[] }).points).toHaveLength(2);
  // The saved list and its CSV export live in the rail's Measure topic (workspace-rail spec §3.2).
  await w.openTopic("Measure");
  await expect(w.topicPanel("Measure")).toContainText("Distance 1");
  await w.topicPanel("Measure").getByRole("button", { name: "Copy all as CSV" }).click();
  const header = (await page.evaluate(() => navigator.clipboard.readText())).split("\r\n")[0];
  expect(header.startsWith("id,name,kind,note,")).toBe(true);
  expect(header.split(",")).toEqual(expect.arrayContaining(["vertex_count", "geometry_wkt", "area_m2"]));
});

// --- the map <-> 3D jumps (S1). M-X owns `mapRoutes` and the two tests that start on the map (IMC
// reconciliation item 8): this block is S1's, copied verbatim from main; M-X edits it by name. ---

const MAP = "a0000000-6666-4000-8000-000000000009";
const RUN = "r0000000-7777-4000-8000-000000000009";
const EXC = "c1a2b3c4-0000-4000-8000-000000000001";
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

/**
 * The map workspace in this file's EPSG:32639 site, built by the fixture's `site` option (R-P3), with
 * `siteRun` as its one ortho's basis run (the AI detections row draws only basis runs) and the fixture
 * cloud linked to that ortho. The spec only renames the fixture's ortho to `MAP` and swaps in its own
 * run and detection.
 */
async function mapRoutes(page: Page) {
  const cors = { "Access-Control-Allow-Origin": "*" };
  const j = (pattern: (u: URL) => boolean, body: unknown) =>
    page.route(pattern, (r) =>
      r.fulfill({ contentType: "application/json", headers: cors, body: JSON.stringify(body) }),
    );
  const world = await serveMapWorkspace(page, {
    surveys: 1,
    site: {
      epsg: 32639,
      proj4: siteMap.proj4,
      name: "WGS 84 / UTM zone 39N",
      bounds: [243500, 3178000, 243600, 3178100],
    },
  });
  await enableDiagnostics(page);
  // The fixture's one ortho, already in the 32639 frame, takes this spec's id (the cloud's `map_id`).
  Object.assign(world.maps[0], { id: MAP, name: siteMap.name });
  const date = String(world.maps[0].captured_on);
  await j((u) => u.pathname === `/api/v1/projects/${P}/map-workspace/surveys`, {
    items: [
      {
        date,
        date_is_import_date: false,
        planned: false,
        note: null,
        maps: [{ id: MAP, name: siteMap.name, gsd_cm: siteMap.gsd_cm, basis_run_id: RUN }],
        surfaces: world.surfaces
          .filter((s) => s.captured_on === date)
          .map((s) => ({ id: s.id, name: s.name, kind: s.kind, elevation_role: s.elevation_role })),
      },
    ],
  });
  await j((u) => u.pathname.endsWith(`/map-runs/${RUN}`), siteRun);
  await j((u) => u.pathname.endsWith(`/maps/${MAP}/runs`), { items: [siteRun] });
  // one detection over the middle of the map, box centre (243550, 3178050)
  world.detections.splice(0, world.detections.length, {
    id: "d1",
    class_id: EXC,
    confidence: 0.9,
    x: 900,
    y: 900,
    w: 200,
    h: 200,
    angle: null,
    review_state: "unreviewed",
    provenance_kind: "local_model",
    corners_site: [
      [243545, 3178055],
      [243555, 3178055],
      [243555, 3178045],
      [243545, 3178045],
    ],
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
  await page.goto(`/p/${P}/maps?map=${MAP}&sel=run:${RUN}`);
  // The click selects only a detection the map has drawn (see untilSelectable).
  await untilSelectable(page, 243550, 3178050, `${RUN}.d1`);
  await clickSite(page, 243550, 3178050);
  await page.getByTestId("map-inspector").getByRole("button", { name: "Open in 3D" }).click();
  // the box centre of corners_site, and its corners as the footprint
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
  // The spot the click picked (a splat near, not on, 243550, 3178050); the cloud and map share EPSG:32639.
  const picked = (await page.evaluate(() => window.__kestrelCloudViewer!.pickCenter()))!;
  expect(Math.hypot(picked.x - 243550, picked.y - 3178050)).toBeLessThan(3);
  await page.getByRole("button", { name: "Show on map" }).click();
  // The workspace takes the `map`/`at` arrival and then strips it (R-URL: assert only the settled
  // URL). It centres the spot rather than marking it (R-P4).
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps(\\?(?!.*\\bat=)[^#]*)?$`));
  const at = await sitePixel(page, picked.x, picked.y);
  const pane = (await page.getByTestId("site-map").boundingBox())!;
  expect(Math.abs(at.x - (pane.x + pane.width / 2))).toBeLessThan(5);
  expect(Math.abs(at.y - (pane.y + pane.height / 2))).toBeLessThan(5);
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
  await edlOn(page);
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
  await page.goto(`/p/${P}/maps?map=${MAP}`);
  await clickSite(page, 243550, 3178050, { button: "right" });
  await page.getByRole("menuitem", { name: "Open this spot in 3D" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/clouds/${CLOUD}\\?at=`));
  await page.goto(`/p/${P}/clouds/${CLOUD}?at=100.000,200.000`);
  await expect(page.getByText("This spot is outside the cloud")).toBeVisible({ timeout: 20_000 });
});

// --- colour modes (C-V1) ---

test("colour modes: Intensity and Class are off for a cloud without those attributes", async ({ page }) => {
  await serveCloudWorld(page, { octree: grid(2) });
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  await edlOn(page);
  const w = ws(page);
  await w.openTopic("Layers");
  await expect(w.colour("RGB")).toBeEnabled();
  await expect(w.colour("Elevation")).toBeEnabled();
  await expect(w.colour("Intensity")).toBeDisabled();
  await expect(w.colour("Class")).toBeDisabled();
  await expect(page.getByText("This cloud has no intensity or classification.")).toBeVisible();
});

/** The fixture grid with intensity, and Ground (2) west of x = 243550, Building (6) east of it. */
async function classifiedCloud(page: Page) {
  const points = redGreenGrid({ origin: [243500, 3178000, 0], size: 100, step: 2 }).map((p, i) => ({
    ...p,
    intensity: (i * 977) % 65536,
    classification: p.x < 243550 ? 2 : 6,
  }));
  await serveCloudWorld(page, {
    octree: buildOctree(points, 0.001, { intensity: true, classification: true }),
  });
  await page.goto(`/p/${P}/clouds/${CLOUD}`);
  await viewerSettled(page);
  await edlOn(page);
  await ws(page).openTopic("Layers"); // Colour by lives in the Layers topic (workspace-rail spec §3.2)
}

test("colour modes: a cloud with intensity and classification draws in both", async ({ page }) => {
  await classifiedCloud(page);
  const w = ws(page);
  await expect(w.colour("Intensity")).toBeEnabled();
  await expect(w.colour("Class")).toBeEnabled();
  await expect(page.getByText(/This cloud has no/)).toHaveCount(0);
  for (const mode of ["Intensity", "Class"] as const) {
    await w.colour(mode).click();
    const c = await page.evaluate(() => window.__kestrelCloudViewer!.sampleColours());
    expect(c.total - c.background, `${mode} draws points`).toBeGreaterThan(0.01 * c.total);
    // S1 spec §17 item 7: the white-colour trap paints every point white (~100 %); < 5 % is fine.
    // Intensity is a grey ramp, so the points above the p98 of the range clamp to white by design.
    const drawn = c.total - c.background;
    if (mode === "Class") expect(c.white, `${mode} is not blown out`).toBe(0);
    else {
      expect(c.white, `${mode} is not blown out (${c.white} of ${drawn})`).toBeLessThan(0.05 * drawn);
      expect(c.red + c.green, `${mode} draws grey, not RGB`).toBe(0);
    }
  }
  expect((await page.evaluate(() => window.__kestrelCloudViewer!.stats())).errors).toEqual([]);
});

test("colour modes: Class draws each half in its class colour, not RGB or the Elevation fallback", async ({
  page,
}) => {
  // "draws points, not white" (above) holds for RGB and Elevation too. The top snapshot's halves tell
  // them apart: in Class the west half is Ground (161, 82, 46) and the east half Building
  // (240, 170, 40), both "red" to `classifyPixels`; RGB's east half is green, and the Elevation ramp
  // it would fall back to (viridis, z rising eastwards on this grid) is red in neither half.
  await classifiedCloud(page);
  await ws(page).colour("Class").click();
  await expect(ws(page).colour("Class")).toHaveAttribute("aria-checked", "true");
  const redShare = (s: { total: number; background: number; red: number }) =>
    s.red / Math.max(1, s.total - s.background);
  await expect
    .poll(async () => {
      const s = await page.evaluate(() => window.__kestrelCloudViewer!.topSnapshotSample(512));
      return s && { west: redShare(s.left) > 0.9, east: redShare(s.right) > 0.9, eastGreen: s.right.green };
    })
    .toEqual({ west: true, east: true, eastGreen: 0 });
});

test("colour modes: Elevation draws the viridis ramp, not RGB", async ({ page }) => {
  // Viridis is never red-dominant for `classifyPixels` (its reddest stop, yellow 253/231/37, is
  // within 40 of green), while RGB draws the west half red: any red pixel means RGB is still drawn.
  await classifiedCloud(page);
  await ws(page).colour("Elevation").click();
  await expect(ws(page).colour("Elevation")).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(async () => {
      const s = await page.evaluate(() => window.__kestrelCloudViewer!.topSnapshotSample(512));
      if (!s) return null;
      const drawn = s.left.total - s.left.background + s.right.total - s.right.background;
      return { drawn: drawn > 0, red: s.left.red + s.right.red };
    })
    .toEqual({ drawn: true, red: 0 });
  // And back: RGB after Elevation draws the grid's own colours again, west red and east green.
  await ws(page).colour("RGB").click();
  await expect(ws(page).colour("RGB")).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(async () => {
      const s = await page.evaluate(() => window.__kestrelCloudViewer!.topSnapshotSample(512));
      return s && { westRed: s.left.red > s.left.green, eastGreen: s.right.green > s.right.red };
    })
    .toEqual({ westRed: true, eastGreen: true });
});
