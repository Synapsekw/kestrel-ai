import { siteTileUrl, type Selection, type SiteFrame, type WorkspaceLayer } from "@/mapws/w4host";
import { longDate } from "./baseCardsModel";

/** The diff ramp's end colours (backend/app/surfaces/tiles.py DIFF_FILL / DIFF_CUT), for the legend. */
export const DIFF_FILL_HEX = "#2166ac";
export const DIFF_CUT_HEX = "#b2182b";
/** Volume polygons drawn per project read (plan budget). */
export const MAX_VOLUMES_DRAWN = 200;

const rank = (l: WorkspaceLayer): number =>
  l.surface_kind === "cloud_dsm" ? 0 : l.surface_kind === "dem" && l.elevation_role === "dsm" ? 1 : -1;

/** A ready, in-frame DSM layer (spec §10: `cloud_dsm`, then `dem` with role `dsm`). */
export function isTopCandidate(l: WorkspaceLayer): boolean {
  return l.kind === "surface" && l.in_frame && l.status === "ready" && rank(l) >= 0;
}

/** The top of a new volume: the r date's DSM (R-W4-14). */
export function topLayerFor(layers: readonly WorkspaceLayer[], r: string | null): WorkspaceLayer | null {
  if (!r) return null;
  const c = layers.filter((l) => isTopCandidate(l) && l.date === r).sort((a, b) => rank(a) - rank(b));
  return c[0] ?? null;
}

export function volumeToolDisabled(layers: readonly WorkspaceLayer[], r: string | null): string | null {
  if (!r) return "Choose a survey date first";
  return topLayerFor(layers, r)
    ? null
    : `No DSM for ${longDate(r)} — import one or build it from a point cloud`;
}

/** True when the surface's coordinates are site coordinates, so native rings draw as they are. */
export function sameFrame(
  frame: SiteFrame | null,
  s: { epsg: number | null; crs_wkt: string | null },
): boolean {
  if (!frame) return false;
  if (frame.kind === "local") return s.crs_wkt == null;
  if (s.crs_wkt == null) return false;
  if (frame.epsg != null && s.epsg != null) return frame.epsg === s.epsg;
  return frame.crs_wkt === s.crs_wkt;
}

/** §6/§12 `GET /site-tiles/volume_diff/{layerId}/{z}/{x}/{y}?v=`: the cut/fill heatmap in the site grid. */
export function heatmapTileUrl(
  baseUrl: string,
  token: string,
  projectId: string,
  measurementId: string,
  v: string,
): string {
  return siteTileUrl(baseUrl, token, projectId, "volume_diff", measurementId, v);
}

export const volumeSelection = (id: string): Selection => ({
  kind: "volume",
  id,
});
