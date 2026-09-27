import type { SiteFrame, Survey, WorkspaceLayer } from "../types";

/** The contract's example map (exampleGeoMap) is in UTM 33N, so the test site frame is too. */
export const UTM33: SiteFrame = {
  kind: "crs",
  crs_wkt: 'PROJCRS["WGS 84 / UTM zone 33N"]',
  epsg: 32633,
  name: "WGS 84 / UTM zone 33N",
  proj4: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",
};

export const LOCAL: SiteFrame = {
  kind: "local",
  crs_wkt: null,
  epsg: null,
  proj4: null,
  name: "Local metres",
};

export function survey(date: string, extra: Partial<Survey> = {}): Survey {
  return {
    date,
    date_is_import_date: false,
    planned: false,
    note: null,
    maps: [],
    surfaces: [],
    ...extra,
  };
}

const GROUP = {
  map: "base",
  surface: "elevation",
  drawing: "drawing",
} as const;

export function layer(
  kind: WorkspaceLayer["kind"],
  id: string,
  extra: Partial<WorkspaceLayer> = {},
): WorkspaceLayer {
  return {
    kind,
    id,
    name: `${kind} ${id}`,
    group: GROUP[kind],
    status: "ready",
    in_frame: true,
    tile_kind: kind === "drawing" ? "drawing_raster" : kind,
    vector: false,
    version: "1",
    date: null,
    date_is_import_date: false,
    footprint_site: [500000, 4981200, 502400, 4983000],
    max_zoom: 17,
    meta: "",
    surface_kind: null,
    elevation_role: null,
    drawing_format: null,
    placed: null,
    ...extra,
  };
}
