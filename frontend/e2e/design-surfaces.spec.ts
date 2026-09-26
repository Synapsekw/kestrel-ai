import { test, expect, type Page } from "@playwright/test";
import { asDetectionProject, jsonReply } from "./kinds";

const P = "7f1c2e3a-1111-4000-8000-000000000001";
const INSP = "d0000000-1111-4000-8000-000000000001";
const PREV = "d0000000-2222-4000-8000-000000000001";
const SURF = "s0000000-4444-4000-8000-000000000001";
const IJ = "j0000000-5555-4000-8000-000000000001";
const PJ = "j0000000-6666-4000-8000-000000000001";
const BJ = "j0000000-7777-4000-8000-000000000001";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkaGhgAAAChACB8f3CzwAAAABJRU5ErkJggg==",
  "base64",
);
const CORS = { "Access-Control-Allow-Origin": "*" };

const job = (id: string, state: string) => ({
  id,
  project_id: P,
  type: "design_import",
  state,
  progress: state === "succeeded" ? 1 : 0,
  message: "",
  log_path: "",
  params: {},
  result: null,
  error: null,
  created_at: "2026-09-24T09:00:00Z",
  started_at: null,
  finished_at: null,
});
const inspection = {
  id: INSP,
  state: "ready",
  error: null,
  job_id: IJ,
  path: "C:\\temp\\site-tin.xml",
  format: "landxml",
  file_size: 2048,
  sha256: "ab".repeat(32),
  detected: {
    horizontal_unit: "metre",
    vertical_unit: "metre",
    unit_source: "LandXML <Metric linearUnit=meter>",
    crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
    epsg: 32639,
    crs_source: "LandXML <CoordinateSystem epsgCode>",
    crs_hint: null,
  },
  candidates: [
    {
      id: "c0",
      kind: "tin_surface",
      name: "Existing ground",
      geometry: "faces",
      bounds_file: [500000, 2800000, 500100, 2800050],
      z_min: -50,
      z_max: -40,
      point_count: 120,
      face_count: 200,
      entity_counts: { invisible_faces: 0 },
      default_selected: true,
      notes: [],
      raster: null,
    },
  ],
  default_target_surface_id: null,
  created_at: "2026-09-24T09:00:00Z",
};
const options = {
  candidate_ids: ["c0"],
  source_crs: "EPSG:32639",
  horizontal_unit: "metre",
  vertical_unit: "metre",
  swap_xy: false,
  target_surface_id: null,
  cell_size_m: 0.5,
  max_edge_m: null,
};
const preview = {
  id: PREV,
  inspection_id: INSP,
  state: "ready",
  error: null,
  job_id: PJ,
  options,
  output: {
    crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
    epsg: 32639,
    cell_size_m: 0.5,
    width: 201,
    height: 101,
    bounds_native: [500000, 2800000, 500100.5, 2800050.5],
    preview_cell_size_m: 0.5,
  },
  triangle_count: 200,
  overlap_fraction: null,
  target_covered_fraction: null,
  design_area_m2: 5000,
  z_check: null,
  warnings: [
    {
      code: "no_target",
      level: "info",
      message: "no cloud surface was chosen, so the design can't be checked against the site",
    },
  ],
  suggestions: [],
  created_at: "2026-09-24T09:01:00Z",
};
const surface = (status: string) => ({
  id: SURF,
  name: "site-tin — Existing ground",
  kind: "design",
  status,
  error: null,
  point_cloud_id: null,
  design_source: null,
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
  epsg: 32639,
  proj4: null,
  cell_size_m: 0.5,
  width: 201,
  height: 101,
  geotransform: [500000, 0.5, 0, 2800050.5, 0, -0.5],
  bounds_native: [500000, 2800000, 500100.5, 2800050.5],
  z_min: -50,
  z_max: -40,
  coverage_fraction: 0.98,
  method: status === "ready" ? "tin" : null,
  build_params: null,
  stats: null,
  captured_on: null,
  map_id: null,
  tile_grid: { tile_size: 256, max_zoom: 0 },
  measurement_count: 0,
  job_id: BJ,
  created_at: "2026-09-24T09:02:00Z",
});

async function stubDesignApi(page: Page, posts: Record<string, unknown[]>) {
  let created = false;
  const base = `/api/v1/projects/${P}`;
  await page.route(
    (u) => u.pathname === `${base}/surfaces`,
    (r) => r.fulfill(jsonReply({ items: created ? [surface("ready")] : [] })),
  );
  await page.route(
    (u) => u.pathname === `${base}/design-inspections`,
    (r) => {
      posts.inspections.push(r.request().postDataJSON());
      return r.fulfill(
        jsonReply(
          {
            inspection: { ...inspection, state: "inspecting", candidates: [], detected: null },
            job: job(IJ, "queued"),
          },
          202,
        ),
      );
    },
  );
  await page.route(
    (u) => u.pathname === `${base}/design-inspections/${INSP}`,
    (r) => {
      if (r.request().method() === "DELETE") {
        posts.deletes.push(INSP);
        return r.fulfill({ status: 204, headers: CORS });
      }
      return r.fulfill(jsonReply(inspection));
    },
  );
  await page.route(
    (u) => u.pathname === `${base}/design-inspections/${INSP}/previews`,
    (r) => {
      posts.previews.push(r.request().postDataJSON());
      return r.fulfill(jsonReply({ preview: { ...preview, state: "running" }, job: job(PJ, "queued") }, 202));
    },
  );
  await page.route(
    (u) => u.pathname === `${base}/design-inspections/${INSP}/previews/${PREV}`,
    (r) => r.fulfill(jsonReply(preview)),
  );
  await page.route(
    (u) => u.pathname.endsWith(`/previews/${PREV}/image`),
    (r) => r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  await page.route(
    (u) => u.pathname.includes("/candidates/") && u.pathname.endsWith("/thumbnail"),
    (r) => r.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG }),
  );
  for (const id of [IJ, PJ, BJ]) {
    await page.route(
      (u) => u.pathname === `${base}/jobs/${id}`,
      (r) => r.fulfill(jsonReply(job(id, "succeeded"))),
    );
  }
  await page.route(
    (u) => u.pathname === `${base}/design-surfaces`,
    (r) => {
      posts.surfaces.push(r.request().postDataJSON());
      created = true;
      return r.fulfill(jsonReply({ surface: surface("building"), job: job(BJ, "queued") }, 202));
    },
  );
}

test.beforeEach(({ page }) => asDetectionProject(page, P));

test("imports a LandXML design with no target and lists it", async ({ page }) => {
  const posts: Record<string, unknown[]> = { inspections: [], previews: [], surfaces: [], deletes: [] };
  await stubDesignApi(page, posts);
  await page.goto(`/p/${P}/volumes`);
  await page.getByRole("button", { name: "Import design surface" }).click();
  const dialog = page.getByRole("dialog", { name: "Import design surface" });
  await dialog.getByLabel("Design file").fill("C:\\temp\\site-tin.xml");
  await dialog.getByRole("button", { name: "Read file" }).click();
  // Playwright's accessible-name matching is substring by default (unlike Testing Library's
  // exact match), and "Target cloud surface" also contains "Surface" — disambiguate with `exact`.
  await expect(dialog.getByRole("combobox", { name: "Surface", exact: true })).toHaveValue("c0");
  await expect(dialog.getByLabel("Source CRS")).toHaveValue("EPSG:32639");
  await dialog.getByLabel("Target cloud surface").selectOption("");
  await dialog.getByLabel("Cell size (m)").fill("0.5");
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(dialog.getByRole("img", { name: "The design over the cloud surface" })).toBeVisible();
  await expect(dialog.getByText("no cloud surface was chosen")).toBeVisible();
  await dialog.getByRole("button", { name: "Import surface" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posts.inspections[0]).toEqual({ path: "C:\\temp\\site-tin.xml" });
  expect(posts.previews[0]).toMatchObject({
    source_crs: "EPSG:32639",
    cell_size_m: 0.5,
    target_surface_id: null,
  });
  expect(posts.surfaces[0]).toMatchObject({ inspection_id: INSP, preview_id: PREV, accept_warnings: false });
  await expect(page.getByText("site-tin — Existing ground")).toBeVisible();
  // A completed import must never delete the inspection it was built from.
  expect(posts.deletes).toHaveLength(0);
});

test("a DWG shows the fix inline", async ({ page }) => {
  await page.route(
    (u) => u.pathname === `/api/v1/projects/${P}/design-inspections`,
    (r) =>
      r.fulfill(
        jsonReply(
          {
            error: {
              code: "validation_error",
              message:
                "DWG files can't be read. Open the drawing in your CAD program (or the free ODA File Converter) and save it as DXF, then import the DXF.",
              details: { reason: "dwg" },
            },
          },
          422,
        ),
      ),
  );
  await page.goto(`/p/${P}/volumes`);
  await page.getByRole("button", { name: "Import design surface" }).click();
  const dialog = page.getByRole("dialog", { name: "Import design surface" });
  await dialog.getByLabel("Design file").fill("C:\\temp\\site.dwg");
  await dialog.getByRole("button", { name: "Read file" }).click();
  await expect(dialog.getByText(/save it as DXF/)).toBeVisible();
});
