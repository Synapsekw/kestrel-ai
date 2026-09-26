import type { PointCloud } from "@/api/clouds";

const grouped = (n: number) => new Intl.NumberFormat("en-GB").format(n).replace(/,/g, " ");

export function formatPoints(n: number): string {
  return n >= 1_000_000 ? `${(n / 1e6).toFixed(1)} M points` : `${grouped(n)} points`;
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e8) return `${Math.round(n / 1e6)} MB`;
  return `${(n / 1e6).toFixed(1)} MB`;
}

export function crsLabel(c: Pick<PointCloud, "epsg" | "crs_wkt">): string {
  if (c.epsg) return `EPSG:${c.epsg}`;
  return c.crs_wkt ? "custom CRS" : "no coordinates";
}

/** The CRS's own name, the first quoted string of its WKT ("WGS 84 / UTM zone 39N"). */
export function crsName(wkt: string | null): string | null {
  const m = wkt ? /^\s*[A-Z_]+\[\s*"([^"]+)"/.exec(wkt) : null;
  return m ? m[1] : null;
}

export function heightsLabel(c: Pick<PointCloud, "vertical_crs">): string {
  return c.vertical_crs ?? "as stored, no vertical datum";
}
