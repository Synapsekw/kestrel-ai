import { test, expect, type Page } from "@playwright/test";
import { evidencePath, entrancesDone } from "./evidence";
import {
  AUG,
  MAP_AUG,
  MAP_FLAT,
  MAP_SEP,
  P,
  SEP,
  SITE,
  enableDiagnostics,
  serveMapWorkspace,
  sharedTiles,
  sitePixel,
} from "./fixtures/mapWorkspace";

// Spec 2026-09-26-map-workspace §15 flow 1, plus the old addresses (§5, §11) and the evaluation
// screen that replaced the pixel viewer. Everything the workspace reads is the stateful fake in
// fixtures/mapWorkspace.ts; anything it does not list is the Prism mock.

const MAP = "a0000000-6666-4000-8000-000000000001";
const RUN = "r0000000-7777-4000-8000-000000000001";
const EXC = "c1a2b3c4-0000-4000-8000-000000000001";
// 1x1 grey PNG; OpenLayers stretches it over the tile, which is all this test needs.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==",
  "base64",
);
const CORS = { "Access-Control-Allow-Origin": "*" };

const map = {
  id: MAP,
  name: "Site north ortho",
  status: "ready",
  error: null,
  source_path: "D:/orthos/site-north.tif",
  source_size: 3221225472,
  width: 8000,
  height: 6000,
  band_count: 3,
  dtype: "uint8",
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 33N"]',
  epsg: 32633,
  proj4: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
  geotransform: [500000, 0.03, 0, 4983000, 0, -0.03],
  bounds_native: [500000, 4982820, 500240, 4983000],
  bounds_wgs84: [15.0, 44.99, 15.003, 45.0],
  gsd_cm: 3,
  tile_grid: { tile_size: 256, max_zoom: 5 },
  labels_version: 0,
  job_id: null,
  created_at: "2026-09-22T10:00:00Z",
};
const run = {
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
  target_gsd_cm: 2,
  job_id: null,
  state: "succeeded",
  counts: { [EXC]: 42 },
  detection_count: 42,
  created_at: "2026-09-22T11:00:00Z",
};
const row = (class_id: string | null) => ({
  class_id,
  tp: 18,
  fp: 2,
  fn: 3,
  precision: 0.9,
  recall: 0.857,
  f1: 0.878,
  predicted: 20,
  actual: 21,
  count_error: -1,
  count_error_pct: -4.76,
});
const score = {
  run_id: RUN,
  iou: 0.5,
  labels_version: 1,
  has_zones: true,
  overall: row(null),
  per_class: [row(EXC)],
  per_zone: [],
  matches: [
    {
      kind: "detection",
      id: "d2",
      match: "fp",
      zone_id: "z1",
      class_id: EXC,
      x: 3000,
      y: 2400,
      w: 170,
      h: 110,
    },
  ],
};

async function json(page: Page, pattern: (u: URL) => boolean, body: unknown, status = 200) {
  await page.route(pattern, (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify(body),
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await enableDiagnostics(page);
});

const layers = (page: Page) => page.getByTestId("layer-row");

/**
 * Show the Sep DSM (surface rows are hidden by default, R-DSM), wait for its Z readout, then hover
 * the site centre so the readout samples the fixture's elevation there.
 */
async function showDsmAndHover(page: Page) {
  await page.getByRole("button", { name: "Show DSM 14 Sep" }).click();
  await expect(page.getByTestId("readout-z")).toBeVisible();
  const c = await sitePixel(page, SITE.cE, SITE.cN);
  await page.mouse.move(c.x, c.y);
}

/** The workspace strips arrival params; what settles is `/p/P/maps` with view params only (R-URL). */
const settledMapsUrl = (u: URL) =>
  u.pathname === `/p/${P}/maps` && !u.searchParams.has("map") && !u.searchParams.has("at");

test("flow 1: two orthos aligned, swipe the divider, side-by-side mirrors the crosshair, blend", async ({
  page,
}) => {
  const world = await serveMapWorkspace(page);
  await page.goto(`/p/${P}/maps?l=${AUG}&r=${SEP}`);
  await expect(page.getByTestId("map-workspace")).toHaveAttribute("data-frame", "crs");
  await expect(page.getByTestId("coord-readout")).toContainText("EPSG:32633");
  await expect(layers(page).filter({ hasText: "14 Aug 2026" })).toBeVisible();
  await expect(layers(page).filter({ hasText: "14 Sep 2026" })).toBeVisible();

  // Swipe: both dates render on one grid, the divider moves and the position is saved (§5, §5.2).
  await page.getByRole("radio", { name: "Swipe" }).click();
  const divider = page.getByRole("slider", { name: "Swipe divider" });
  await expect(divider).toBeVisible();
  await expect.poll(() => sharedTiles(world, MAP_AUG, MAP_SEP).length).toBeGreaterThan(0);
  const d = (await divider.boundingBox())!;
  const stage = (await page.getByTestId("site-map").boundingBox())!;
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width * 0.25, d.y + d.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect.poll(async () => Number(await divider.getAttribute("aria-valuenow"))).toBeLessThan(35);
  await expect
    .poll(() => world.calls.some((c) => c.method === "PUT" && c.path === "/map-workspace"), { timeout: 5000 })
    .toBe(true);
  await entrancesDone(page);
  await page.screenshot({ path: evidencePath("maps", "flow1-swipe.png") });

  // Side-by-side: two maps on one View; the pointer's crosshair shows as a ghost on the other side.
  await page.getByRole("radio", { name: "Side-by-side" }).click();
  const left = page.getByTestId("site-map-left");
  const right = page.getByTestId("site-map-right");
  await expect(left).toBeVisible();
  await expect(right).toBeVisible();
  await expect(page.getByRole("region", { name: "Layers" }).getByTestId("layer-row").first()).toBeHidden();
  const lb = (await left.boundingBox())!;
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  const ghost = page.getByTestId("ghost-crosshair");
  await expect(ghost).toBeVisible();
  const gb = (await ghost.boundingBox())!;
  const rb = (await right.boundingBox())!;
  expect(gb.x + gb.width / 2).toBeGreaterThan(rb.x);
  expect(Math.abs(gb.y + gb.height / 2 - (lb.y + lb.height / 2))).toBeLessThan(3);
  await page.screenshot({
    path: evidencePath("maps", "flow1-side-by-side.png"),
  });

  // Blend: the right date's opacity; the layers panel comes back after Side-by-side (§5).
  await page.getByRole("radio", { name: "Blend" }).click();
  await expect(layers(page).first()).toBeVisible();
  const blend = page.getByRole("slider", { name: "Blend" });
  const before = Number(await blend.getAttribute("aria-valuenow"));
  await blend.focus();
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => Number(await blend.getAttribute("aria-valuenow"))).toBeLessThan(before);

  // `C` cycles the compare mode back to Single (§5.1 workspace keys). The keys are window-level
  // and `site-map` is not focusable, so release the Blend slider's focus first.
  await blend.blur();
  await page.keyboard.press("c");
  await expect(page.getByRole("radio", { name: "Single" })).toBeChecked();
});

test("the Z readout samples the right date's DSM under the pointer (§5 Coordinates)", async ({ page }) => {
  const world = await serveMapWorkspace(page);
  await page.goto(`/p/${P}/maps?l=${AUG}&r=${SEP}`);
  await showDsmAndHover(page);
  await expect(page.getByTestId("readout-z")).toHaveText("Z 612.34 m");
  expect(world.calls.some((x) => x.path === "/map-workspace/sample")).toBe(true);
});

test("the coordinates readout fits at 1280 px with the frame switch shown (R-HX)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await serveMapWorkspace(page);
  // Both frames hold items, so the frame switch renders in the readout's row (M §6). The fake
  // reports no local items, so this test answers the workspace read itself.
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/map-workspace`,
    (r) =>
      r.request().method() !== "GET"
        ? r.fallback()
        : r.fulfill({
            status: 200,
            contentType: "application/json",
            headers: CORS,
            body: JSON.stringify({
              frame: {
                kind: "crs",
                crs_wkt: SITE.crs_wkt,
                epsg: SITE.epsg,
                proj4: SITE.proj4,
                name: SITE.name,
              },
              state: world.workspaceState,
              planned_surveys: [],
              frame_items: { crs: 5, local: 2 },
              updated_at: "2026-09-22T12:00:00Z",
            }),
          }),
  );
  await page.goto(`/p/${P}/maps`);
  const readout = page.getByTestId("coord-readout");
  await expect(readout).toContainText("EPSG:32633");
  await expect(readout.getByRole("button", { name: "Local metres · 2 surfaces" })).toBeVisible();
  // The widest row: E, N and a sampled Z under the pointer, next to the switch.
  await showDsmAndHover(page);
  await expect(readout).toContainText(/E 500\d{3}\.\d{2}/);
  await expect(readout.getByTestId("readout-z")).toHaveText("Z 612.34 m");
  await entrancesDone(page);

  const fit = await readout.evaluate((el) => {
    const rows = [el, ...Array.from(el.children)] as HTMLElement[];
    return {
      overflowing: rows
        .filter((r) => r.scrollWidth > r.clientWidth)
        .map((r) => `${r.scrollWidth} > ${r.clientWidth}`),
      right: el.getBoundingClientRect().right,
      viewport: window.innerWidth,
    };
  });
  expect(fit.overflowing).toEqual([]);
  expect(fit.right).toBeLessThanOrEqual(fit.viewport);
  await page.screenshot({
    path: evidencePath("maps", "flow1-readout-1280.png"),
  });
});

test("compare with one survey keeps Single only (§14)", async ({ page }) => {
  await serveMapWorkspace(page, { surveys: 1 });
  await page.goto(`/p/${P}/maps`);
  await expect(page.getByRole("radio", { name: "Single" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Swipe" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: "Side-by-side" })).toBeDisabled();
});

test("the retired viewer's address opens the workspace on that map", async ({ page }) => {
  await serveMapWorkspace(page);
  await page.goto(`/p/${P}/maps/${MAP_SEP}`);
  // The exact redirect target is pinned in routes.test.tsx; here, where it settles (R-URL): the
  // workspace, on the Sep map's date.
  await expect(page).toHaveURL(settledMapsUrl);
  await expect(page.getByTestId("map-workspace")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Single" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Survey: 14 Sep 2026" })).toBeVisible();
});

test("a map without coordinates is listed greyed and opens its evaluation view (§14)", async ({ page }) => {
  await serveMapWorkspace(page, { flatMap: true });
  await page.goto(`/p/${P}/maps`);
  const noCrs = page.getByTestId("layer-row").filter({ hasText: "no coordinates" });
  await expect(noCrs).toBeVisible();
  await noCrs.getByRole("link", { name: "open in evaluation view" }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${P}/maps/${MAP_FLAT}/evaluate$`));
  await expect(page.getByTestId("map-panel")).toContainText("No coordinates in this file");
  await expect(page.getByRole("radio", { name: "Results" })).toBeChecked();
});

test("the evaluation view labels, draws an evaluation zone, scores and exports", async ({ page }) => {
  const zonePosts: unknown[] = [];
  const exportPosts: unknown[] = [];
  await page.route(
    (u) => u.pathname.includes(`/maps/${MAP}/tiles/`),
    (r) =>
      r.fulfill({
        status: 200,
        contentType: "image/png",
        headers: CORS,
        body: PNG,
      }),
  );
  await json(page, (u) => u.pathname === `/api/v1/projects/${P}/maps`, {
    items: [map],
  });
  await json(page, (u) => u.pathname.endsWith(`/maps/${MAP}/runs`), {
    items: [run],
  });
  await json(page, (u) => u.pathname.endsWith(`/maps/${MAP}/labels`), {
    items: [],
  });
  await json(page, (u) => u.pathname.endsWith("/density"), {
    cell_size: 8000,
    cells: [{ gx: 0, gy: 0, class_id: EXC, count: 42 }],
  });
  await json(page, (u) => u.pathname.endsWith("/detections"), {
    items: [
      {
        id: "d1",
        class_id: EXC,
        confidence: 0.9,
        x: 1000,
        y: 1000,
        w: 180,
        h: 120,
        angle: null,
      },
    ],
    truncated: false,
  });
  await json(page, (u) => u.pathname.endsWith("/score"), score);
  await page.route(
    (u) => u.pathname.endsWith(`/maps/${MAP}/zones`),
    async (r) => {
      if (r.request().method() === "POST") {
        zonePosts.push(r.request().postDataJSON());
        return r.fulfill({
          status: 201,
          contentType: "application/json",
          headers: CORS,
          body: JSON.stringify({
            id: "z1",
            map_id: MAP,
            name: "Zone 1",
            polygon: [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 10],
            ],
          }),
        });
      }
      return r.fulfill({
        status: 200,
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({ items: [] }),
      });
    },
  );
  await page.route(
    (u) => u.pathname.endsWith("/map-exports"),
    (r) => {
      exportPosts.push(r.request().postDataJSON());
      return r.fulfill({
        status: 202,
        contentType: "application/json",
        headers: CORS,
        body: JSON.stringify({
          job: {
            id: "j0000000-4444-4000-8000-000000000001",
            project_id: P,
            type: "map_export",
            state: "queued",
            progress: 0,
            message: "",
            log_path: "",
            params: {},
            result: null,
            error: null,
            created_at: "2026-09-22T12:00:00Z",
            started_at: null,
            finished_at: null,
          },
        }),
      });
    },
  );

  const firstTile = page.waitForRequest((r) => r.url().includes(`/maps/${MAP}/tiles/`));
  await page.goto(`/p/${P}/maps/${MAP}/evaluate`);
  await firstTile;
  await expect(page.getByTestId("map-panel")).toContainText("EPSG:32633");
  await expect(page.getByRole("link", { name: "Open in map" })).toHaveAttribute(
    "href",
    `/p/${P}/maps?map=${MAP}`,
  );

  const canvas = page.getByTestId("map-view");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText(/° N, .*° E/)).toBeVisible();

  await page.getByRole("checkbox", { name: /Show machinery-v3/ }).check();
  await page.getByRole("radio", { name: "Labels" }).click();
  await page.getByRole("radio", { name: "Zone ▭" }).click();
  // `createBox` completes on a click-move-click sequence as well as on press-drag-release; the
  // click form is the one that finishes reliably in headless Chromium.
  await page.mouse.click(box.x + 100, box.y + 100);
  await page.mouse.move(box.x + 250, box.y + 220, { steps: 5 });
  await page.mouse.click(box.x + 250, box.y + 220);
  await expect.poll(() => zonePosts.length).toBe(1);
  expect((zonePosts[0] as { polygon: number[][] }).polygon).toHaveLength(4);

  await page.getByRole("radio", { name: "Score" }).click();
  await expect(page.getByRole("row", { name: "Precision" })).toContainText("90.0 %");

  await page.getByRole("button", { name: "Export" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Export" }).click();
  await expect.poll(() => exportPosts.length).toBe(1);
  expect(exportPosts[0]).toMatchObject({
    map_id: MAP,
    content: "run",
    formats: ["geojson", "gpkg", "csv"],
  });
});
