import type { MapMeasurement } from "@/api/mapMeasurements";
import { makeStores, renderInWorkspace } from "@/mapws/test/harness";
import { layer, survey } from "@/mapws/test/fixtures";
import {
  type CompareMode,
  type SiteFrame,
  type Survey,
  type WorkspaceLayer,
} from "@/mapws/annotations/bindings";

export const UTM38: SiteFrame = {
  kind: "crs",
  crs_wkt: 'PROJCRS["WGS 84 / UTM zone 38N"]',
  epsg: 32638,
  name: "WGS 84 / UTM zone 38N",
  proj4: "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs",
};
export const AUG = "2026-08-14";
export const SEP = "2026-09-14";
export const MAP_AUG = "a0000000-6666-4000-8000-0000000000a8";
export const MAP_SEP = "a0000000-6666-4000-8000-0000000000a9";
export const DSM_AUG = "s0000000-aaaa-4000-8000-0000000000a8";
export const DSM_SEP = "s0000000-aaaa-4000-8000-0000000000a9";
export const DESIGN = "s0000000-aaaa-4000-8000-0000000000de";
export const MEASURE_ID = "mm000000-1111-4000-8000-000000000001";
export const MEASURE_ID_2 = "mm000000-1111-4000-8000-000000000002";

/** A 1 km square site footprint (site extent). */
export const FOOT: [number, number, number, number] = [500000, 3300000, 501000, 3301000];

const surface = (
  id: string,
  name: string,
  date: string | null,
  surface_kind: WorkspaceLayer["surface_kind"],
  elevation_role: WorkspaceLayer["elevation_role"],
): WorkspaceLayer =>
  layer("surface", id, {
    name,
    date,
    footprint_site: FOOT,
    surface_kind,
    elevation_role,
  });

export const LAYERS: WorkspaceLayer[] = [
  layer("map", MAP_AUG, { name: "August ortho", date: AUG, footprint_site: FOOT }),
  layer("map", MAP_SEP, { name: "September ortho", date: SEP, footprint_site: FOOT }),
  surface(DSM_AUG, "DSM 14 Aug", AUG, "cloud_dsm", null),
  surface(DSM_SEP, "DSM 14 Sep", SEP, "dem", "dsm"),
  surface(DESIGN, "Site plan rev C", null, "design", null),
];

export const SURVEYS: Survey[] = [
  survey(AUG, {
    maps: [{ id: MAP_AUG, name: "August ortho", gsd_cm: 2, basis_run_id: null }],
    surfaces: [{ id: DSM_AUG, name: "DSM 14 Aug", kind: "cloud_dsm", elevation_role: null }],
  }),
  survey(SEP, {
    maps: [{ id: MAP_SEP, name: "September ortho", gsd_cm: 2, basis_run_id: null }],
    surfaces: [{ id: DSM_SEP, name: "DSM 14 Sep", kind: "dem", elevation_role: "dsm" }],
  }),
  survey("2026-10-14", { planned: true }),
];

export const SHOWN_ALL = { layerState: {}, order: {} };

/**
 * W1's stores for a UTM 38 site with the two surveys, `l` = Aug, `r` = Sep, the layers loaded (M-W3
 * preflight P2: seeded straight into `workspace.setLayers`, no `useWorkspaceLayers` mock).
 */
export function w3Stores(
  opts: { mode?: CompareMode; frame?: SiteFrame; layers?: WorkspaceLayer[] } = {},
) {
  const stores = makeStores({ frame: opts.frame ?? UTM38, surveys: SURVEYS });
  const ws = stores.workspace.getState();
  ws.setLayers(opts.layers ?? LAYERS, false);
  if (opts.mode && opts.mode !== "single") ws.setMode(opts.mode);
  ws.setDates(AUG, SEP);
  return stores;
}

/** Replaces the layers on an already-built `w3Stores()` (M-W3 preflight P2). */
export function seedLayers(
  stores: ReturnType<typeof makeStores>,
  layers: WorkspaceLayer[] = LAYERS,
): void {
  stores.workspace.getState().setLayers(layers, false);
}

/** W1's `renderInWorkspace`, re-exported so every W3 test imports its fixtures from one module. */
export { renderInWorkspace };

type Kind = "distance" | "area" | "profile";

/** A map measurement as `?frame=site` returns it (M-C0's shapes). */
export function measurement(kind: Kind, patch: Record<string, unknown> = {}): MapMeasurement {
  const line = [
    [500100, 3300100],
    [500130, 3300140],
  ];
  const square = [
    [500000, 3300000],
    [501000, 3300000],
    [501000, 3301000],
    [500000, 3301000],
  ];
  const vertices = kind === "area" ? square : line;
  return {
    id: MEASURE_ID,
    name: kind === "distance" ? "Distance 1" : kind === "area" ? "Area 1" : "Profile 1",
    note: null,
    kind,
    crs_wkt: 'PROJCRS["WGS 84 / UTM zone 38N"]',
    epsg: 32638,
    vertices,
    vertices_site: vertices,
    surface_ids: kind === "profile" ? [DSM_AUG, DSM_SEP] : [DSM_SEP],
    map_id: MAP_SEP,
    created_at: "2026-09-27T10:00:00Z",
    updated_at: "2026-09-27T10:00:00Z",
    results:
      kind === "distance"
        ? {
            length_m: 50.02,
            grid_length_m: 50.0,
            scale_factor: 0.99962,
            length_3d_m: 50.31,
            nodata_fraction: 0,
            dsm_surface_id: DSM_SEP,
          }
        : kind === "area"
          ? {
              area_m2: 1000752.4,
              perimeter_m: 4001.5,
              grid_area_m2: 1000000,
              grid_perimeter_m: 4000,
              areal_scale_factor: 0.99925,
            }
          : {
              length_m: 50.02,
              grid_length_m: 50,
              stations_m: [0, 10, 20, 30, 40, 50],
              series: [
                {
                  surface_id: DSM_AUG,
                  label: "DSM 14 Aug",
                  date: AUG,
                  z: [600, 601, 602, null, 604, 605],
                },
                {
                  surface_id: DSM_SEP,
                  label: "DSM 14 Sep",
                  date: SEP,
                  z: [600, 603, 601, 603, 606, 605],
                },
              ],
              z_min: 600,
              z_max: 606,
              cut_area_m2: 10,
              fill_area_m2: 40,
              nodata_fraction: 0.1,
            },
    ...patch,
  } as unknown as MapMeasurement;
}
