import { test, expect, type Page } from "@playwright/test";
import { asDetectionProject, jsonReply } from "./kinds";
import { evidencePath } from "./evidence";

// The Volumes screen against the Prism mock (plan deviation 6): the backend's real pipeline is
// covered by pytest and the acceptance walkthrough; here every S2 call is answered by page.route
// with a small stateful fake, so the four flows of spec section 13 run end to end in the webview.
const P = "7f1c2e3a-1111-4000-8000-000000000001";
const CLOUD = "c0000000-9999-4000-8000-000000000001";
const SURFACE = "s0000000-9999-4000-8000-000000000001";
const M = "v0000000-9999-4000-8000-000000000001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==",
  "base64",
);
const CORS = { "Access-Control-Allow-Origin": "*" };
const job = (type: string) => ({
  id: `j-${type}`,
  project_id: P,
  type,
  state: "queued",
  progress: 0,
  message: "",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-24T10:00:00Z",
  started_at: null,
  finished_at: null,
});

const surface = {
  id: SURFACE,
  name: "April survey",
  kind: "cloud_dsm",
  status: "ready",
  error: null,
  point_cloud_id: CLOUD,
  design_source: null,
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
  epsg: 32639,
  proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
  cell_size_m: 0.1,
  width: 1200,
  height: 900,
  geotransform: [500000, 0.1, 0, 3300000, 0, -0.1],
  bounds_native: [500000, 3299910, 500120, 3300000],
  z_min: -46,
  z_max: 190,
  coverage_fraction: 0.9,
  method: "median",
  build_params: null,
  stats: null,
  captured_on: "2026-04-02",
  map_id: null,
  tile_grid: { tile_size: 256, max_zoom: 3 },
  measurement_count: 1,
  job_id: null,
  created_at: "2026-09-24T09:00:00Z",
};
const results = {
  fill_m3: 1234.5,
  cut_m3: 2.1,
  net_m3: 1232.4,
  unshifted: null,
  area_m2: 400,
  polygon_area_m2: 400.1,
  measured_area_m2: 396,
  masked_area_m2: 0,
  excluded_area_m2: 0,
  nodata_area_m2: 4,
  cell_size_m: 0.1,
  areal_scale_factor: 0.99962,
  shift_applied_m: 0,
  alignment: null,
  base_fit: {
    kind: "toe_plane",
    samples: 800,
    rejected: 4,
    usable_edge_fraction: 0.97,
    rms_m: 0.03,
    plane: [0, 0, -45],
  },
  uncertainty: {
    total_m3: 14.2,
    base_m3: 11.9,
    alignment_m3: null,
    cell_size_m3: 1.1,
    nodata_m3: 7.4,
    patch_m3: 0,
    complete: true,
  },
  warnings: [],
  footprints_used: 0,
  patch_regions: 0,
  diff_scale_m: 4.2,
  top_surface: {
    id: SURFACE,
    name: "April survey",
    kind: "cloud_dsm",
    method: "median",
    cell_size_m: 0.1,
    captured_on: "2026-04-02",
    cloud_file: "chimney.las",
    cloud_sha256: "ab",
  },
  base_surface: null,
  inputs: {},
  inputs_fingerprint: "f".repeat(64),
  engine_version: 1,
  computed_at: "2026-09-24T10:00:00Z",
  duration_s: 1.2,
};
const measurement = {
  id: M,
  name: "Pile 1",
  status: "ready",
  error: null,
  polygon_native: [
    [500010, 3299990],
    [500030, 3299990],
    [500030, 3299970],
    [500010, 3299970],
  ],
  top_surface_id: SURFACE,
  base: { kind: "toe_plane", z: null, surface_id: null },
  masks: { detection_run_ids: [], class_ids: null, buffer_m: 1, exclusion_polygons: [] },
  alignment: { stable_polygon: null, apply_shift: false, measured: null },
  results,
  stale_reasons: [],
  job_id: null,
  created_at: "2026-09-24T09:30:00Z",
  updated_at: "2026-09-24T10:00:00Z",
};

async function fakeVolumes(page: Page) {
  const state = {
    measurement: { ...measurement } as Record<string, unknown>,
    surfaces: [] as unknown[],
    posts: [] as unknown[],
  };
  await page.route(
    (u) => /\/surfaces\/[^/]+\/(tiles|ortho-tiles)\//.test(u.pathname) || u.pathname.includes("/diff-tiles/"),
    (r) => r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  await page.route(
    (u) => u.pathname.endsWith("/sample"),
    (r) => r.fulfill(jsonReply({ x: 500020, y: 3299980, z: -41.2 })),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/pointclouds`,
    (r) =>
      r.fulfill(jsonReply({ items: [{ id: CLOUD, name: "Chimney", status: "ready", crs_wkt: "PROJCS" }] })),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/surfaces`,
    (r) => {
      if (r.request().method() === "POST") {
        state.posts.push({ url: "surfaces", body: r.request().postDataJSON() });
        state.surfaces = [surface];
        return r.fulfill(
          jsonReply({ surface: { ...surface, status: "building" }, job: job("surface_build") }, 202),
        );
      }
      return r.fulfill(jsonReply({ items: state.surfaces }));
    },
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/volumes`,
    (r) => r.fulfill(jsonReply({ items: state.surfaces.length ? [state.measurement] : [] })),
  );
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/volumes/${M}`,
    (r) => {
      if (r.request().method() === "PATCH") {
        const body = r.request().postDataJSON();
        state.posts.push({ url: "patch", body });
        state.measurement = {
          ...state.measurement,
          ...body,
          status: "stale",
          stale_reasons: ["base changed"],
        };
      }
      return r.fulfill(jsonReply(state.measurement));
    },
  );
  await page.route(
    (u) => u.pathname.endsWith(`/volumes/${M}/calculate`),
    (r) => {
      state.posts.push({ url: "calculate" });
      state.measurement = { ...state.measurement, status: "ready", stale_reasons: [] };
      return r.fulfill(jsonReply({ measurement: state.measurement, job: job("volume_calc") }, 202));
    },
  );
  await page.route(
    (u) => u.pathname.endsWith("/volume-exports"),
    (r) => {
      state.posts.push({ url: "export", body: r.request().postDataJSON() });
      return r.fulfill(jsonReply({ job: job("volume_export") }, 202));
    },
  );
  return state;
}

test.beforeEach(({ page }) => asDetectionProject(page, P));

test("builds a surface, measures a pile, goes stale on a base change, recalculates and exports", async ({
  page,
}) => {
  const state = await fakeVolumes(page);
  await page.goto(`/p/${P}/volumes`);
  await expect(page.getByText("Build a surface from a point cloud")).toBeVisible();

  // 1. Build a surface; the hillshade renders.
  await page.getByRole("button", { name: "Build surface" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Chimney surface");
  const firstTile = page.waitForRequest((r) => r.url().includes(`/surfaces/${SURFACE}/tiles/`));
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await firstTile;
  expect(state.posts[0]).toEqual({
    url: "surfaces",
    body: { point_cloud_id: CLOUD, name: "Chimney surface", method: "median" },
  });

  // 2. The calculated measurement shows its fill.
  await page
    .getByRole("list", { name: "Measurements" })
    .getByRole("button", { name: /Pile 1/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/volumes/${M}$`));
  await expect(page.getByTestId("results-panel")).toContainText("1 234.5 m³");
  await expect(page.getByTestId("results-panel")).toContainText("± 14.2 m³ (indicative)");
  await page.screenshot({ path: evidencePath("volumes", "results.png"), fullPage: true });

  // 3. A flat base makes it stale; Recalculate runs the job.
  await page.getByRole("radio", { name: "Measure" }).click();
  await page.getByLabel("Base").selectOption("flat");
  await expect(page.getByText("Inputs changed: base changed — Recalculate")).toBeVisible();
  await page.getByRole("button", { name: "Recalculate" }).click();
  await expect.poll(() => state.posts.some((p) => (p as { url: string }).url === "calculate")).toBe(true);

  // 4. Export all four formats.
  await page.getByRole("radio", { name: "Results" }).click();
  await page.getByRole("button", { name: "Export…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Export" }).click();
  await expect
    .poll(() => state.posts.find((p) => (p as { url: string }).url === "export"))
    .toEqual({ url: "export", body: { measurement_ids: [M], formats: ["pdf", "gpkg", "csv", "xlsx"] } });
});
