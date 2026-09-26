import type { DesignInspection, DesignPreview, Surface } from "@/api/designSurfaces";
import { PROJECT_ID } from "@/test/fixtures";

export const INSPECTION_ID = "d0000000-1111-4000-8000-000000000001";
export const PREVIEW_ID = "d0000000-2222-4000-8000-000000000001";
export const TARGET_ID = "s0000000-3333-4000-8000-000000000001";
export const DESIGN_ID = "s0000000-4444-4000-8000-000000000001";
export const INSPECT_JOB = "j0000000-5555-4000-8000-000000000001";
export const PREVIEW_JOB = "j0000000-6666-4000-8000-000000000001";
export const BUILD_JOB = "j0000000-7777-4000-8000-000000000001";

const surfaceBase: Surface = {
  id: TARGET_ID,
  name: "Chimney DSM",
  kind: "cloud_dsm",
  status: "ready",
  error: null,
  point_cloud_id: "c0000000-8888-4000-8000-000000000001",
  design_source: null,
  crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
  epsg: 32639,
  proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
  cell_size_m: 0.1,
  width: 4000,
  height: 3000,
  geotransform: [500000, 0.1, 0, 2800300, 0, -0.1],
  bounds_native: [500000, 2800000, 500400, 2800300],
  z_min: -52,
  z_max: 12,
  coverage_fraction: 0.93,
  method: "median",
  build_params: null,
  stats: null,
  captured_on: "2026-04-15",
  map_id: null,
  tile_grid: { tile_size: 256, max_zoom: 4 },
  measurement_count: 0,
  job_id: null,
  created_at: "2026-09-23T10:00:00Z",
};

export const exampleTarget: Surface = surfaceBase;

export const designSurface: Surface = {
  ...surfaceBase,
  id: DESIGN_ID,
  name: "site-tin — Existing ground",
  kind: "design",
  status: "building",
  point_cloud_id: null,
  method: null,
  captured_on: null,
  job_id: BUILD_JOB,
};

export const landxmlInspection: DesignInspection = {
  id: INSPECTION_ID,
  state: "ready",
  error: null,
  job_id: INSPECT_JOB,
  path: "D:\\designs\\site-tin.xml",
  format: "landxml",
  file_size: 1_234_567,
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
      bounds_file: [500000, 2800000, 500400, 2800300],
      z_min: -50,
      z_max: 8,
      point_count: 12_000,
      face_count: 23_800,
      entity_counts: { invisible_faces: 12 },
      default_selected: true,
      notes: [],
      raster: null,
    },
    {
      id: "c1",
      kind: "tin_surface",
      name: "Grid 1m",
      geometry: "faces",
      bounds_file: [500000, 2800000, 500400, 2800300],
      z_min: -50,
      z_max: 8,
      point_count: 120,
      face_count: 0,
      entity_counts: { invisible_faces: 0 },
      default_selected: false,
      notes: [{ code: "not_tin", level: "block", message: "grid-type LandXML surfaces aren't supported" }],
      raster: null,
    },
  ],
  default_target_surface_id: TARGET_ID,
  created_at: "2026-09-24T09:00:00Z",
};

export const dxfInspection: DesignInspection = {
  ...landxmlInspection,
  path: "D:\\designs\\contours.dxf",
  format: "dxf",
  detected: {
    horizontal_unit: null,
    vertical_unit: null,
    unit_source: "DXF $INSUNITS=1 (not supported; choose the unit)",
    crs_wkt: null,
    epsg: null,
    crs_source: null,
    crs_hint: "GEODATA: UTM84-39N",
  },
  candidates: [
    {
      id: "c0",
      kind: "dxf_layer",
      name: "CONTOURS",
      geometry: "points",
      bounds_file: [500000, 2800000, 500400, 2800300],
      z_min: -50,
      z_max: 8,
      point_count: 80_000,
      face_count: 0,
      entity_counts: { lwpolyline: 58, polyline_3d: 0, point: 0, unsupported: 0 },
      default_selected: true,
      notes: [],
      raster: null,
    },
    {
      id: "c1",
      kind: "dxf_layer",
      name: "TEXT",
      geometry: "none",
      bounds_file: [0, 0, 0, 0],
      z_min: null,
      z_max: null,
      point_count: 0,
      face_count: 0,
      entity_counts: { unsupported: 40 },
      default_selected: false,
      notes: [
        { code: "empty_result", level: "block", message: "nothing on this layer can be used as a surface" },
      ],
      raster: null,
    },
  ],
};

export const demInspection: DesignInspection = {
  ...landxmlInspection,
  path: "D:\\designs\\design-dem.tif",
  format: "geotiff",
  detected: {
    horizontal_unit: null,
    vertical_unit: "metre",
    unit_source: "CRS axis unit",
    crs_wkt: 'PROJCS["WGS 84 / UTM zone 38N"]',
    epsg: 32638,
    crs_source: "GeoTIFF CRS",
    crs_hint: null,
  },
  candidates: [
    {
      id: "c0",
      kind: "dem",
      name: "band 1",
      geometry: "raster",
      bounds_file: [740000, 2800000, 740400, 2800300],
      z_min: -50,
      z_max: 8,
      point_count: 0,
      face_count: 0,
      entity_counts: {},
      default_selected: true,
      notes: [],
      raster: {
        width: 400,
        height: 300,
        cell_x: 1,
        cell_y: 1,
        dtype: "float32",
        nodata: -9999,
        band_count: 1,
      },
    },
  ],
};

const previewBase: DesignPreview = {
  id: PREVIEW_ID,
  inspection_id: INSPECTION_ID,
  state: "ready",
  error: null,
  job_id: PREVIEW_JOB,
  options: {
    candidate_ids: ["c0"],
    source_crs: "EPSG:32639",
    horizontal_unit: "metre",
    vertical_unit: "metre",
    swap_xy: false,
    target_surface_id: TARGET_ID,
    cell_size_m: null,
    max_edge_m: null,
  },
  output: {
    crs_wkt: 'PROJCS["WGS 84 / UTM zone 39N"]',
    epsg: 32639,
    cell_size_m: 0.1,
    width: 4000,
    height: 3000,
    bounds_native: [500000, 2800000, 500400, 2800300],
    preview_cell_size_m: 0.8,
  },
  triangle_count: 23_800,
  overlap_fraction: 0.973,
  target_covered_fraction: 0.95,
  design_area_m2: 118_000,
  z_check: {
    median_dz_m: 0.12,
    p05_dz_m: -0.3,
    p95_dz_m: 0.41,
    n_samples: 150_000,
    design_z_min_m: -50,
    design_z_max_m: 8,
  },
  warnings: [
    {
      code: "crs_from_file",
      level: "info",
      message: "CRS from the file (LandXML <CoordinateSystem epsgCode>)",
    },
  ],
  suggestions: [],
  created_at: "2026-09-24T09:01:00Z",
};

export const readyPreview: DesignPreview = previewBase;

export const warnPreview: DesignPreview = {
  ...previewBase,
  overlap_fraction: 0.01,
  warnings: [
    {
      code: "no_overlap",
      level: "warn",
      message: "the design and the cloud surface don't overlap (1 % of the design lies on it)",
    },
  ],
  suggestions: [
    {
      code: "swap_xy",
      message: "With easting/northing swapped the design covers 97 % of the cloud surface.",
      overlap_fraction: 0.97,
      options_patch: { swap_xy: true },
    },
  ],
};

export const blockedPreview: DesignPreview = {
  ...previewBase,
  warnings: [{ code: "mixed_geometry", level: "block", message: "the selection mixes 3D faces and lines" }],
};

export { PROJECT_ID };
