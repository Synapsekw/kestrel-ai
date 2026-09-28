import type { Job, Surface } from "@contract/client";
import type { Drawing, DrawingInspection } from "@/api/drawings";
import type { LayerRow } from "@/mapws/layers/layerRegistry";
import { layer } from "@/mapws/test/fixtures";
import type { SiteFrame } from "@/mapws/types";
import { PROJECT_ID } from "@/test/fixtures";

export const DRAWING_ID = "e0000000-1111-4000-8000-000000000001";
export const INSPECTION_ID = "e0000000-2222-4000-8000-000000000001";
export const INSPECT_JOB = "j0000000-8888-4000-8000-000000000001";
export const BUILD_JOB = "j0000000-9999-4000-8000-000000000001";
export const DEM_ID = "s0000000-5555-4000-8000-000000000001";

/**
 * Preflight adaptation #2: the merged `SiteFrame` (`@/mapws/types`, contract schema) requires
 * `crs_wkt`; the brief's literal omitted it. `placedPdfDrawing.georef.dst_crs_wkt` below uses this
 * exact string (PF7 — the server stores `frame.crs_wkt` verbatim, `backend/app/drawings/router.py:276`).
 */
export const SITE_FRAME: SiteFrame = {
  kind: "crs",
  epsg: 32638,
  crs_wkt: 'PROJCRS["WGS 84 / UTM zone 38N",ID["EPSG",32638]]',
  name: "WGS 84 / UTM zone 38N",
  proj4: "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs",
};

export const drawingJob = (id: string, state: string, type = "drawing_import"): Job =>
  ({
    id,
    project_id: PROJECT_ID,
    type,
    state,
    progress: state === "succeeded" ? 1 : 0.3,
    message: "Reading drawing",
    log_path: "",
    params: {},
    result: null,
    error: null,
    created_at: "2026-09-27T09:00:00Z",
    started_at: null,
    finished_at: null,
  }) as Job;

const inspectionBase: DrawingInspection = {
  id: INSPECTION_ID,
  state: "ready",
  error: null,
  job_id: INSPECT_JOB,
  path: "D:\\plans\\foundation-plan.pdf",
  format: "pdf",
  file_size: 5_242_880,
  sha256: null,
  units: null,
  units_source: null,
  crs_hint: null,
  extent_src: null,
  layers: [],
  page_count: 2,
  pages: [
    { page: 1, width_pt: 2384, height_pt: 1684 },
    { page: 2, width_pt: 2384, height_pt: 1684 },
  ],
  width: null,
  height: null,
  embedded: null,
  warnings: [],
  created_at: "2026-09-27T09:00:00Z",
};

export const pdfInspection: DrawingInspection = inspectionBase;

/** One 100 × 60 inch page: 300 dpi would be 30 000 px wide. */
export const bigPdfInspection: DrawingInspection = {
  ...inspectionBase,
  path: "D:\\plans\\site-poster.pdf",
  page_count: 1,
  pages: [{ page: 1, width_pt: 7200, height_pt: 4320 }],
};

export const pngWorldFileInspection: DrawingInspection = {
  ...inspectionBase,
  path: "D:\\plans\\scan.png",
  format: "png",
  page_count: null,
  pages: [],
  width: 4000,
  height: 3000,
  embedded: {
    source: "world_file",
    crs_wkt: null,
    epsg: null,
    transform: [0.05, 0, 500000, 0, 0.05, 4983000],
    needs_crs: true,
  },
  warnings: [
    {
      code: "world_file_needs_crs",
      message: "The world file has no CRS: enter its EPSG code.",
    },
  ],
};

export const dxfInspection: DrawingInspection = {
  ...inspectionBase,
  path: "D:\\plans\\site-plan.dxf",
  format: "dxf",
  page_count: null,
  pages: [],
  units: "millimetre",
  units_source: "DXF $INSUNITS=4",
  crs_hint: "WGS 84 / UTM zone 38N (EPSG:32638)",
  extent_src: [500000000, 4982900000, 500200000, 4983000000],
  layers: [
    {
      name: "WALLS",
      colour: "#ff0000",
      entity_count: 812,
      visible_default: true,
    },
    {
      name: "TEXT",
      colour: "#ffffff",
      entity_count: 95,
      visible_default: true,
    },
    {
      name: "DEFPOINTS",
      colour: "#808080",
      entity_count: 0,
      visible_default: false,
    },
  ],
  warnings: [
    {
      code: "geodata_unverified",
      message: "The file names a CRS in GEODATA; check it before placing.",
    },
  ],
};

export const pdfDrawing: Drawing = {
  id: DRAWING_ID,
  name: "foundation-plan · p2",
  format: "pdf",
  kind: "raster",
  status: "ready",
  error: null,
  job_id: BUILD_JOB,
  source_path: "D:\\plans\\foundation-plan.pdf",
  source_size: 5_242_880,
  page: 2,
  units: null,
  width: 4967,
  height: 3508,
  dpi: 150,
  extent_src: [0, -3508, 4967, 0],
  layers: [],
  georef: null,
  georef_version: 0,
  bounds_site: null,
  layer_state: { hidden_layers: [], knockout_white: false },
  captured_on: null,
  created_at: "2026-09-27T09:00:00Z",
  updated_at: "2026-09-27T09:00:00Z",
};

export const placedPdfDrawing: Drawing = {
  ...pdfDrawing,
  georef: {
    method: "control_points",
    crs_wkt: null,
    epsg: null,
    model: "similarity",
    points: [
      { id: "cp1", src: [100, -100], dst: [500002, 4982998] },
      { id: "cp2", src: [4800, -100], dst: [500096, 4982998] },
      { id: "cp3", src: [100, -3400], dst: [500002, 4982932] },
    ],
    // PF7: the same string as SITE_FRAME.crs_wkt — the server stores the frame's WKT verbatim.
    dst_crs_wkt: SITE_FRAME.crs_wkt,
    transform: [0.02, 0, 500000, 0, 0.02, 4983000],
    rmse_m: 0.06,
    residuals_m: [0.05, 0.07, 0.06],
    warnings: [],
  },
  georef_version: 2,
  bounds_site: [500000, 4982930, 500100, 4983000],
};

export const dxfDrawing: Drawing = {
  ...pdfDrawing,
  id: "e0000000-3333-4000-8000-000000000001",
  name: "site-plan",
  format: "dxf",
  kind: "vector",
  source_path: "D:\\plans\\site-plan.dxf",
  page: null,
  width: null,
  height: null,
  dpi: null,
  units: "metre",
  extent_src: [500000, 4982900, 500200, 4983000],
  layers: dxfInspection.layers,
  layer_state: { hidden_layers: ["TEXT"], knockout_white: false },
  georef: {
    method: "crs",
    crs_wkt: 'PROJCRS["WGS 84 / UTM zone 38N",ID["EPSG",32638]]',
    epsg: 32638,
    model: null,
    points: [],
    dst_crs_wkt: null,
    transform: [1, 0, 0, 0, 1, 0],
    rmse_m: null,
    residuals_m: [],
    warnings: [],
  },
  georef_version: 1,
};

/**
 * The W1 layer row the `drawing` layer kind makes for a drawing.
 * Preflight adaptation #3/PF2: the merged `WorkspaceLayer` is the contract schema (`vector`,
 * `placed`, `status`, `max_zoom`, `footprint_site`, `in_frame`, `tile_kind`, `drawing_format`, …),
 * not the plan's `raw.{vector,placed,status}` shape — built with `mapws/test/fixtures.ts`'s
 * `layer(...)` helper, no `as unknown as` cast.
 */
export function drawingRowOf(d: Drawing, version = String(d.georef_version)): LayerRow {
  const placed = d.georef !== null;
  const meta = placed ? "placed" : "not placed";
  return {
    key: `drawing:${d.id}`,
    kind: "drawing",
    group: "drawings",
    id: d.id,
    name: d.name,
    meta,
    date: null,
    badge: placed ? "GEO" : undefined,
    version,
    layer: layer("drawing", d.id, {
      name: d.name,
      version,
      vector: d.kind === "vector",
      placed,
      status: d.status,
      drawing_format: d.format,
      in_frame: placed,
      tile_kind: d.kind === "vector" ? null : "drawing_raster",
      footprint_site: d.bounds_site,
      max_zoom: 18,
      meta,
    }),
  };
}

const surfaceBase = {
  status: "ready",
  error: null,
  point_cloud_id: null,
  design_source: null,
  crs_wkt: 'PROJCRS["WGS 84 / UTM zone 38N"]',
  epsg: 32638,
  proj4: "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs",
  cell_size_m: 0.05,
  width: 4000,
  height: 3000,
  geotransform: [500000, 0.05, 0, 4983000, 0, -0.05],
  bounds_native: [500000, 4982850, 500200, 4983000],
  z_min: 598.1,
  z_max: 624.8,
  coverage_fraction: 0.97,
  method: null,
  build_params: null,
  stats: null,
  map_id: null,
  tile_grid: { tile_size: 256, max_zoom: 6 },
  measurement_count: 0,
  job_id: null,
};

export const cloudDsm = {
  ...surfaceBase,
  id: "s0000000-6666-4000-8000-000000000001",
  name: "Aug cloud DSM",
  kind: "cloud_dsm",
  elevation_role: null,
  captured_on: "2026-08-14",
  created_at: "2026-08-15T10:00:00Z",
} as unknown as Surface;

export const demSurface = {
  ...surfaceBase,
  id: DEM_ID,
  name: "Sep DSM",
  kind: "dem",
  elevation_role: "dsm",
  captured_on: "2026-09-14",
  created_at: "2026-09-15T10:00:00Z",
} as unknown as Surface;
