import type { OverviewSite } from "@/api/overview";

/** A local equirectangular frame (north up), padded by 10%. Enough for a site-sized area with no basemap. */
export interface SiteFrame {
  width: number;
  height: number;
  metresPerUnit: number;
  project(lon: number, lat: number): { x: number; y: number };
  /** The inverse of `project`: frame units back to degrees. */
  unproject(x: number, y: number): { lon: number; lat: number };
}

const M_PER_DEG_LAT = 111_320;
const MIN_SPAN_DEG = 0.001; // ~100 m: one photo or a tiny site still gets a frame

export function siteFrame(site: OverviewSite): SiteFrame | null {
  const b = site.bounds_wgs84;
  if (!b) return null;
  const [minlon0, minlat0, maxlon0, maxlat0] = b;
  const cx = (minlon0 + maxlon0) / 2;
  const cy = (minlat0 + maxlat0) / 2;
  const halfLon = Math.max(maxlon0 - minlon0, MIN_SPAN_DEG) * 0.6;
  const halfLat = Math.max(maxlat0 - minlat0, MIN_SPAN_DEG) * 0.6;
  const k = Math.cos((cy * Math.PI) / 180);
  const minlon = cx - halfLon;
  const maxlat = cy + halfLat;
  return {
    width: 2 * halfLon * k,
    height: 2 * halfLat,
    metresPerUnit: M_PER_DEG_LAT,
    project: (lon, lat) => ({ x: (lon - minlon) * k, y: maxlat - lat }),
    unproject: (x, y) => ({ lon: minlon + x / k, lat: maxlat - y }),
  };
}

const STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];

export function niceScale(metresAcross: number): { metres: number; label: string } {
  const target = metresAcross / 4;
  const metres = STEPS.reduce(
    (best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best),
    STEPS[0],
  );
  return { metres, label: metres >= 1000 ? `${metres / 1000} km` : `${metres} m` };
}
