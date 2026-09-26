import proj4 from "proj4";
import type { GeoMap } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import { pixelToNative } from "@/maps/coords";

/** The 3D-jump URL contract (spec §2, §10): `?at=x,y[&fp=x,y;…]` in the destination's native CRS. */
export interface XY {
  x: number;
  y: number;
}

const NUM = /^-?\d+(\.\d+)?$/;
const pair = (s: string): XY | null => {
  const parts = s.split(",");
  return parts.length === 2 && NUM.test(parts[0]) && NUM.test(parts[1])
    ? { x: Number(parts[0]), y: Number(parts[1]) }
    : null;
};

export function parseAt(q: URLSearchParams): XY | null {
  const v = q.get("at");
  return v ? pair(v) : null;
}

export function parseFootprint(q: URLSearchParams): XY[] | null {
  const v = q.get("fp");
  if (!v) return null;
  const pts = v.split(";").map(pair);
  return pts.every((p): p is XY => p !== null) ? pts : null;
}

const f3 = (v: number) => v.toFixed(3);

export function jumpQuery(at: XY, fp?: XY[]): string {
  const base = `?at=${f3(at.x)},${f3(at.y)}`;
  return fp?.length ? `${base}&fp=${fp.map((p) => `${f3(p.x)},${f3(p.y)}`).join(";")}` : base;
}

/** The inverse of the GDAL geotransform, rotation terms included. */
export function nativeToPixel(gt: number[], x: number, y: number): [number, number] {
  const det = gt[1] * gt[5] - gt[2] * gt[4];
  const dx = x - gt[0];
  const dy = y - gt[3];
  return [(gt[5] * dx - gt[2] * dy) / det, (-gt[4] * dx + gt[1] * dy) / det];
}

type Georef = { proj4?: string | null; epsg?: number | null };

export function between(from: Georef, to: Georef): (p: XY) => XY {
  if ((from.epsg && from.epsg === to.epsg) || from.proj4 === to.proj4) return (p) => ({ x: p.x, y: p.y });
  const t = proj4(from.proj4!, to.proj4!);
  return (p) => {
    const [x, y] = t.forward([p.x, p.y]);
    return { x, y };
  };
}

export function mapPixelToCloud(
  map: GeoMap,
  cloud: Pick<PointCloud, "proj4" | "epsg">,
  px: number,
  py: number,
): XY {
  const [x, y] = pixelToNative(map.geotransform!, px, py);
  return between(map, cloud)({ x, y });
}

export function cloudToMapNative(
  cloud: Pick<PointCloud, "proj4" | "epsg">,
  map: Pick<GeoMap, "proj4" | "epsg">,
  p: XY,
): XY {
  return between(cloud, map)(p);
}

export function cloudsForMap(clouds: PointCloud[], mapId: string): PointCloud[] {
  return clouds
    .filter((c) => c.status === "ready" && c.map_id === mapId && c.proj4)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function insideXY(b: number[], p: XY): boolean {
  return p.x >= b[0] && p.x <= b[3] && p.y >= b[1] && p.y <= b[4];
}

export function footprintDiagonal(fp: XY[]): number {
  const xs = fp.map((p) => p.x);
  const ys = fp.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}
