import { test, expect, type Page } from "@playwright/test";
import { evidencePath } from "./evidence";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const MAP = "a0000000-6666-4000-8000-000000000002";
const MODEL = "m0000000-2222-4000-8000-000000000009";
const DATASET = "d0000000-7777-4000-8000-000000000002";
// 1x1 grey PNG; OpenLayers stretches it over the tile, which is all this test needs.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==",
  "base64",
);
const CORS = { "Access-Control-Allow-Origin": "*" };

const map = {
  id: MAP, name: "UTM_transparent_mosaic_group1", status: "ready", error: null,
  source_path: "D:/orthos/AHTest/UTM_transparent_mosaic_group1.tif",
  source_size: 2469606195, width: 42000, height: 38000, band_count: 3, dtype: "uint8",
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 33N"]', epsg: 32633,
  proj4: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
  geotransform: [500000, 0.02296, 0, 4983000, 0, -0.02296],
  bounds_native: [500000, 4982128, 500964, 4983000],
  bounds_wgs84: [15.0, 44.99, 15.012, 45.0], gsd_cm: 2.296, tile_grid: { tile_size: 256, max_zoom: 7 },
  labels_version: 0, job_id: null, created_at: "2026-09-22T10:00:00Z",
};

// The scale a model trained on senseFly Aeria X imagery flown at ~191 m was actually derived at:
// real numbers from the gsd-estimate contract test, not invented ones (spec section 3).
const gsdEstimate = {
  train_gsd_cm: 18.92,
  image_gsd_cm: 6.055,
  median_alt_m: 191.02,
  focal_mm: 18.5,
  sensor_width_mm: 23.456,
  sensor_source: "focal_plane",
  sample_size: 8,
  imgsz: 1280,
  median_object_m: 8.39,
  per_class_m: { excavator: 8.39, dump_truck: 8.9, roller: 5.07 },
  plausible: true,
};

const model = {
  id: MODEL,
  name: "ICVD_V4",
  kind: "trained",
  weights_path: "models/ICVD_V4.pt",
  base_weights: "yolo11m.pt",
  dataset_id: DATASET,
  hyperparameters: { epochs: 120, imgsz: 1280 },
  metrics: {
    map50: 0.83,
    map50_95: 0.61,
    precision: 0.86,
    recall: 0.79,
    per_class: [{ class_name: "excavator", map50: 0.85, map50_95: 0.63, precision: 0.87, recall: 0.8 }],
  },
  class_names: ["excavator", "dump_truck", "roller"],
  class_aliases: {},
  exports: {},
  artifacts: {},
  run_id: null,
  train_gsd_cm: null,
  created_at: "2026-09-10T09:00:00Z",
};

// The run that produced the reported failure: ICVD_V4 against this map at the map's own
// 2.296 cm/px, which found 1.5 m of gravel. It has to be present for this test to prove anything —
// mocking `/runs` as empty is the one state in which a past run cannot be handed back.
const pastRun = {
  id: "r0000000-3333-4000-8000-000000000001", map_id: MAP, kind: "local_model", model_id: MODEL,
  provider: null, model_name: "ICVD_V4", query: "", tile_size: 1280, overlap: 0.2, nms_iou: 0.5,
  conf: 0.25, target_gsd_cm: 2.296, job_id: null, state: "succeeded",
  counts: { excavator: 3 }, detection_count: 3, created_at: "2026-09-22T11:00:00Z",
};

async function json(page: Page, pattern: (u: URL) => boolean, body: unknown, status = 200) {
  await page.route(pattern, (route) =>
    route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(body) }),
  );
}

test("a model with no training scale offers its derived one, with the evidence for it", async ({ page }) => {
  await page.route((u) => u.pathname.includes(`/maps/${MAP}/tiles/`), (r) =>
    r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  await page.route((u) => u.pathname.endsWith(`/maps/${MAP}/preview`), (r) =>
    r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  await json(page, (u) => u.pathname === `/api/v1/projects/${P}/maps`, { items: [map] });
  await json(page, (u) => u.pathname.endsWith(`/maps/${MAP}/runs`), { items: [pastRun] });
  await json(page, (u) => u.pathname.endsWith(`/maps/${MAP}/labels`), { items: [] });
  await json(page, (u) => u.pathname.endsWith(`/maps/${MAP}/zones`), { items: [] });
  await json(page, (u) => u.pathname.endsWith("/density"), { cell_size: 8000, cells: [] });
  await json(page, (u) => u.pathname.endsWith("/detections"), { items: [], truncated: false });
  await json(page, (u) => u.pathname === `/api/v1/projects/${P}/models`, { items: [model], next_cursor: null });
  await json(page, (u) => u.pathname.endsWith(`/models/${MODEL}/gsd-estimate`), gsdEstimate);

  const firstTile = page.waitForRequest((r) => r.url().includes(`/maps/${MAP}/tiles/`));
  await page.goto(`/p/${P}/maps/${MAP}`);
  await firstTile;

  await page.getByRole("button", { name: "New run" }).click();
  const dialog = page.getByRole("dialog", { name: "Detect on this map" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Model", { exact: true })).toHaveValue(MODEL);

  const offer = dialog.getByText(/This model was trained at about/);
  await expect(offer).toContainText("trained at about 18.92 cm / px");
  await expect(offer).toContainText("flown at about 191.02 m");
  await expect(offer).toContainText("machines about 8.39 m across");
  const use = dialog.getByRole("button", { name: "Use 18.92" });
  await expect(use).toBeVisible();

  // The scale is still unknown at this exact moment, and this map already carries a run recorded
  // at 2.296 cm/px. The field must stay empty rather than reinstate that number, and the run's
  // central guarantee — cannot start without a scale — must hold right here, not just in theory.
  const field = dialog.getByLabel("Model trained at (cm / px)");
  await expect(field).toHaveValue("");
  const start = dialog.getByRole("button", { name: "Start detection" });
  await expect(start).toBeDisabled();

  await page.screenshot({
    path: evidencePath("model-gsd", "2026-09-23-scale-offer.png"),
    animations: "disabled",
  });

  await use.click();
  await expect(field).toHaveValue("18.92");
  await expect(start).toBeEnabled();
});
