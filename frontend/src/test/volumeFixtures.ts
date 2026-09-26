/**
 * Volumes fixtures (spec 2026-09-23-volumes). Kept apart from `fixtures.ts`, which every screen's
 * tests share, so the S2 tasks never edit the same file as another spec.
 */
import type { MapRun, Surface, VolumeMeasurement } from "@contract/client";
import { JOB_ID, MAP_ID, PROJECT_ID, exampleMapRun } from "./fixtures";

export const CLOUD_ID = "c0000000-9999-4000-8000-000000000001";
export const SURFACE_ID = "s0000000-9999-4000-8000-000000000001";
export const BASE_SURFACE_ID = "s0000000-9999-4000-8000-000000000002";
export const MEASUREMENT_ID = "v0000000-9999-4000-8000-000000000001";
export { PROJECT_ID };

const GT = [500000, 0.1, 0, 3300000, 0, -0.1];
const RING = [
  [500010, 3299990],
  [500030, 3299990],
  [500030, 3299970],
  [500010, 3299970],
];

export const exampleSurface: Surface = {
  id: SURFACE_ID,
  name: "April survey",
  kind: "cloud_dsm",
  status: "ready",
  error: null,
  point_cloud_id: CLOUD_ID,
  design_source: null,
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
  epsg: 32639,
  proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
  cell_size_m: 0.1,
  width: 1200,
  height: 900,
  geotransform: GT,
  bounds_native: [500000, 3299910, 500120, 3300000],
  z_min: -46.2,
  z_max: 190.4,
  coverage_fraction: 0.93,
  method: "median",
  build_params: {
    point_cloud_id: CLOUD_ID,
    name: "April survey",
    method: "median",
    cell_size_m: 0.1,
    auto_cell: true,
    hole_fill_max_gap_m: 1,
    despike_m: 1,
    z_clip: null,
    drop_noise_classes: true,
    assume_metres: false,
  },
  stats: {
    points_read: 21697184,
    points_used: 21695000,
    points_dropped: { noise_class: 2184, withheld: 0, z_clip: 0 },
    density_per_m2: 410,
    spacing_m: 0.049,
    auto_cell: true,
    cells_valid: 1004400,
    cells_despiked: 12,
    cells_filled: 3810,
    z_p02: -45.9,
    z_p98: -38.1,
    reprojected_from_epsg: null,
    build_s: 41.2,
  },
  captured_on: "2026-04-02",
  map_id: MAP_ID,
  tile_grid: { tile_size: 256, max_zoom: 3 },
  measurement_count: 1,
  job_id: JOB_ID,
  created_at: "2026-09-24T09:00:00Z",
};

export const exampleBaseSurface: Surface = {
  ...exampleSurface,
  id: BASE_SURFACE_ID,
  name: "March survey",
  captured_on: "2026-03-01",
  map_id: null,
  measurement_count: 0,
};

export const exampleResults: VolumeMeasurement["results"] = {
  fill_m3: 1234.5,
  cut_m3: 2.1,
  net_m3: 1232.4,
  unshifted: null,
  area_m2: 400,
  polygon_area_m2: 400.1,
  measured_area_m2: 396,
  masked_area_m2: 12.5,
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
    plane: [0.01, 0, -45],
  },
  uncertainty: {
    total_m3: 14.2,
    base_m3: 11.9,
    alignment_m3: null,
    cell_size_m3: 1.1,
    nodata_m3: 7.4,
    patch_m3: 1.8,
    complete: true,
  },
  warnings: [],
  footprints_used: 1,
  patch_regions: 1,
  diff_scale_m: 4.2,
  top_surface: {
    id: SURFACE_ID,
    name: "April survey",
    kind: "cloud_dsm",
    method: "median",
    cell_size_m: 0.1,
    captured_on: "2026-04-02",
    cloud_file: "chimney.las",
    cloud_sha256: "ab".repeat(32),
  },
  base_surface: null,
  inputs: {},
  inputs_fingerprint: "f".repeat(64),
  engine_version: 1,
  computed_at: "2026-09-24T10:00:00Z",
  duration_s: 1.2,
};

export const exampleMeasurement: VolumeMeasurement = {
  id: MEASUREMENT_ID,
  name: "Pile 1",
  status: "ready",
  error: null,
  polygon_native: RING,
  top_surface_id: SURFACE_ID,
  base: { kind: "toe_plane", z: null, surface_id: null },
  masks: { detection_run_ids: [], class_ids: null, buffer_m: 1, exclusion_polygons: [] },
  alignment: { stable_polygon: null, apply_shift: false, measured: null },
  results: exampleResults,
  stale_reasons: [],
  job_id: JOB_ID,
  created_at: "2026-09-24T09:30:00Z",
  updated_at: "2026-09-24T10:00:00Z",
};

export const otherFlightRun: MapRun = {
  ...exampleMapRun,
  id: "r0000000-7777-4000-8000-000000000002",
  map_id: "other-map",
};
