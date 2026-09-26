import type { ApiClient, components } from "@contract/client";
import { unwrap } from "@/api/errors";

export type DataItem = components["schemas"]["DataItem"];

/** The data types the Maps tab lists (spec 2026-09-26-foundation section 5.3). */
export const MAP_DATA_TYPES = ["map", "elevation", "drawing"] as const;
export const MAP_PAGE = 100;

export function fetchMapItems(api: ApiClient, projectId: string, cursor: string | null) {
  return unwrap(
    api.GET("/api/v1/projects/{projectId}/data", {
      params: {
        path: { projectId },
        query: { type: [...MAP_DATA_TYPES], limit: MAP_PAGE, ...(cursor ? { cursor } : {}) },
      },
    }),
  );
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The mono detail column: resolution and CRS for a map, cell size for an elevation model. */
export function detailOf(item: DataItem): string {
  const s = (item.summary ?? {}) as Record<string, unknown>;
  if (item.type === "map") {
    const gsd = num(s.gsd_cm);
    const epsg = num(s.epsg);
    return [gsd !== null ? `${gsd} cm/px` : null, epsg !== null ? `EPSG:${epsg}` : null]
      .filter(Boolean)
      .join(" · ");
  }
  if (item.type === "elevation") {
    const cell = num(s.cell_size_m);
    return cell !== null ? `${cell} m cells` : "";
  }
  return "";
}
