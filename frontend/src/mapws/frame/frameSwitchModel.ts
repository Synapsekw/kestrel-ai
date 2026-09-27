import type { ApiClient, GeoMap, components } from "@contract/client";
import { unwrap } from "@/api/errors";
import type { FrameItemCounts } from "../state/workspaceStore";

type S = components["schemas"];

/** `PUT /map-workspace/frame` (setSiteFrame): `crs` needs an EPSG code, else 422 `invalid_epsg`. */
export async function setSiteFrame(
  api: ApiClient,
  projectId: string,
  body: S["SiteFrameSet"],
): Promise<void> {
  await unwrap(
    api.PUT("/api/v1/projects/{projectId}/map-workspace/frame", { params: { path: { projectId } }, body }),
  );
}

/** "Local metres · 2 items" in a CRS frame, "Site CRS · 4 items" in the local one. */
export function frameSwitchLabel(kind: "crs" | "local", items: FrameItemCounts): string {
  const n = kind === "local" ? items.crs : items.local;
  return `${kind === "local" ? "Site CRS" : "Local metres"} · ${n} ${n === 1 ? "item" : "items"}`;
}

/**
 * The EPSG code of the last CRS frame the workspace showed, per project, for the switch back from
 * local metres. Session memory only: the app has no CRS picker, so the site CRS is rule M3's and
 * `defaultSiteEpsg` recovers it after a restart.
 */
const lastCrsEpsg = new Map<string, number>();

export function rememberCrsEpsg(projectId: string, epsg: number): void {
  lastCrsEpsg.set(projectId, epsg);
}

export function rememberedCrsEpsg(projectId: string): number | null {
  return lastCrsEpsg.get(projectId) ?? null;
}

/** Tests only. */
export function forgetCrsEpsg(): void {
  lastCrsEpsg.clear();
}

const GEOGRAPHIC = /\+proj=(longlat|latlong|lonlat|latlon)\b/;

function utmEpsg(lon: number, lat: number): number {
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  return (lat >= 0 ? 32600 : 32700) + zone;
}

/**
 * Rule M3 (backend `choose_frame` / `frame_for_crs`) over the maps list: the oldest ready map with
 * coordinates decides; a projected CRS in metres is the frame as it is, a geographic one becomes the
 * UTM zone of the map's centre. Null when no map qualifies or the chosen CRS has no EPSG code (the
 * server validates the code again: a wrong guess is a 422 toast, never a silent frame).
 */
export function defaultSiteEpsg(maps: readonly GeoMap[]): number | null {
  const georeferenced = maps
    .filter((m) => m.status === "ready" && m.crs_wkt !== null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const m of georeferenced) {
    const proj4 = m.proj4 ?? "";
    if (GEOGRAPHIC.test(proj4)) {
      const b = m.bounds_wgs84;
      if (b) return utmEpsg((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      continue; // no centre: M3 moves on to the next item
    }
    if (/\+units=m\b/.test(proj4)) return m.epsg;
    // not in metres: M3 moves on
  }
  return null;
}
