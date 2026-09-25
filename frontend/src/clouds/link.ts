import type { GeoMap } from "@contract/client";
import type { PointCloud } from "@/api/clouds";

export const SAME_FLIGHT_OVERLAP = 0.5;

export interface RankedMap {
  map: GeoMap;
  /** Share of the cloud's WGS84 box that the map covers, 0..1. */
  overlap: number;
  likelySameFlight: boolean;
}

function area(b: number[]): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

function intersection(a: number[], b: number[]): number[] {
  return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
}

/** Ready maps with a CRS that overlap the cloud, best first (spec §2 "Map link"). */
export function rankMaps(
  cloud: Pick<PointCloud, "bounds_wgs84" | "captured_on">,
  maps: GeoMap[],
): RankedMap[] {
  const box = cloud.bounds_wgs84;
  if (!box || area(box) === 0) return [];
  return maps
    .filter((m) => m.status === "ready" && m.crs_wkt && m.bounds_wgs84)
    .map((m) => {
      const overlap = area(intersection(box, m.bounds_wgs84!)) / area(box);
      return {
        map: m,
        overlap,
        likelySameFlight:
          overlap >= SAME_FLIGHT_OVERLAP && !!cloud.captured_on && m.captured_on === cloud.captured_on,
      };
    })
    .filter((r) => r.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || Number(b.likelySameFlight) - Number(a.likelySameFlight));
}
