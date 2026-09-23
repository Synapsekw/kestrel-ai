import { test, expect, type Page } from "@playwright/test";
import { asDetectionProject } from "./kinds";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
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
  id: MAP, name: "Site north ortho", status: "ready", error: null, source_path: "D:/orthos/site-north.tif",
  source_size: 3221225472, width: 8000, height: 6000, band_count: 3, dtype: "uint8",
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 33N"]', epsg: 32633,
  proj4: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
  geotransform: [500000, 0.03, 0, 4983000, 0, -0.03], bounds_native: [500000, 4982820, 500240, 4983000],
  bounds_wgs84: [15.0, 44.99, 15.003, 45.0], gsd_cm: 3, tile_grid: { tile_size: 256, max_zoom: 5 },
  labels_version: 0, job_id: null, created_at: "2026-09-22T10:00:00Z",
};
const run = {
  id: RUN, map_id: MAP, kind: "local_model", model_id: "m0000000-2222-4000-8000-000000000001", provider: null,
  model_name: "machinery-v3", query: "", tile_size: 1280, overlap: 0.2, nms_iou: 0.5, conf: 0.25, target_gsd_cm: 2,
  job_id: null, state: "succeeded", counts: { [EXC]: 42 }, detection_count: 42, created_at: "2026-09-22T11:00:00Z",
};
const row = (class_id: string | null) => ({
  class_id, tp: 18, fp: 2, fn: 3, precision: 0.9, recall: 0.857, f1: 0.878, predicted: 20, actual: 21, count_error: -1, count_error_pct: -4.76,
});
const score = {
  run_id: RUN, iou: 0.5, labels_version: 1, has_zones: true, overall: row(null), per_class: [row(EXC)], per_zone: [],
  matches: [{ kind: "detection", id: "d2", match: "fp", zone_id: "z1", class_id: EXC, x: 3000, y: 2400, w: 170, h: 110 }],
};

test.beforeEach(({ page }) => asDetectionProject(page, P));

async function json(page: Page, pattern: (u: URL) => boolean, body: unknown, status = 200) {
  await page.route(pattern, (route) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) }),
  );
}

test("opens a map, counts a run, draws a zone, scores and exports", async ({ page }) => {
  const zonePosts: unknown[] = [];
  const exportPosts: unknown[] = [];
  await page.route((u) => u.pathname.includes(`/maps/${MAP}/tiles/`), (r) =>
    r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  await page.route((u) => u.pathname.endsWith(`/maps/${MAP}/preview`), (r) =>
    r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  await json(page, (u) => u.pathname === `/api/v1/projects/${P}/maps`, { items: [map] });
  await json(page, (u) => u.pathname.endsWith(`/maps/${MAP}/runs`), { items: [run] });
  await json(page, (u) => u.pathname.endsWith(`/maps/${MAP}/labels`), { items: [] });
  await json(page, (u) => u.pathname.endsWith("/density"), { cell_size: 8000, cells: [{ gx: 0, gy: 0, class_id: EXC, count: 42 }] });
  await json(page, (u) => u.pathname.endsWith("/detections"), {
    items: [{ id: "d1", class_id: EXC, confidence: 0.9, x: 1000, y: 1000, w: 180, h: 120, angle: null }], truncated: false,
  });
  await json(page, (u) => u.pathname.endsWith("/score"), score);
  await page.route((u) => u.pathname.endsWith(`/maps/${MAP}/zones`), async (r) => {
    if (r.request().method() === "POST") {
      zonePosts.push(r.request().postDataJSON());
      return r.fulfill({ status: 201, contentType: "application/json", headers: CORS, body: JSON.stringify({ id: "z1", map_id: MAP, name: "Zone 1", polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }) });
    }
    return r.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify({ items: [] }) });
  });
  await page.route((u) => u.pathname.endsWith("/map-exports"), (r) => {
    exportPosts.push(r.request().postDataJSON());
    return r.fulfill({ status: 202, contentType: "application/json", headers: CORS, body: JSON.stringify({ job: { id: "j0000000-4444-4000-8000-000000000001", project_id: P, type: "map_export", state: "queued", progress: 0, message: "", log_path: "", params: {}, result: null, error: null, created_at: "2026-09-22T12:00:00Z", started_at: null, finished_at: null } }) });
  });

  const firstTile = page.waitForRequest((r) => r.url().includes(`/maps/${MAP}/tiles/`));
  await page.goto(`/p/${P}/maps/${MAP}`);
  await firstTile;
  await expect(page.getByTestId("map-panel")).toContainText("EPSG:32633");

  const canvas = page.getByTestId("map-view");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText(/° N, .*° E/)).toBeVisible();

  await page.getByRole("checkbox", { name: /Show machinery-v3/ }).check();
  await expect(page.getByRole("row", { name: /excavator/ })).toContainText("42");

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
  expect(exportPosts[0]).toMatchObject({ map_id: MAP, content: "run", formats: ["geojson", "gpkg", "csv"] });
});
