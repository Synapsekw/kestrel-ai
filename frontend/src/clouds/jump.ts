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

/** Spec §10.4 / C9: the image, finding and photo-link arrivals. Malformed parameters are ignored. */
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const id = (v: string | null): string | null => (v && ID.test(v) ? v : null);

export interface FromImage {
  imageId: string;
  /** A pixel in the stored image (`image.width/height` space). */
  u: number;
  v: number;
}

export function parseFromImage(q: URLSearchParams): FromImage | null {
  const imageId = id(q.get("from_image"));
  const px = pair(q.get("px") ?? "");
  if (!imageId || !px || px.x < 0 || px.y < 0) return null;
  return { imageId, u: px.x, v: px.y };
}

export function parseFinding(q: URLSearchParams): string | null {
  return id(q.get("finding"));
}

export type CloudArrival =
  | { kind: "finding"; findingId: string }
  | ({ kind: "from_image" } & FromImage)
  | { kind: "at"; at: XY; fp: XY[] | null };

/** The first valid arrival, in the order finding, from_image, at (plan x1 Ruling 8). */
export function parseCloudArrival(q: URLSearchParams): CloudArrival | null {
  const findingId = parseFinding(q);
  if (findingId) return { kind: "finding", findingId };
  const fromImage = parseFromImage(q);
  if (fromImage) return { kind: "from_image", ...fromImage };
  const at = parseAt(q);
  return at ? { kind: "at", at, fp: parseFootprint(q) } : null;
}

const f1 = (v: number) => v.toFixed(1);

/** The image -> cloud query (`/p/:pid/clouds/:cid` + this). */
export function fromImageQuery(imageId: string, u: number, v: number): string {
  return `?from_image=${encodeURIComponent(imageId)}&px=${f1(u)},${f1(v)}`;
}

export interface ImageSpot {
  px: number;
  py: number;
  rpx: number;
}

/**
 * The cloud -> image link, I §6.5's arrival: `?at=px,py&r=rpx&from=cloud:<cloudId>` in stored-image
 * pixels. Without a spot (a "by distance" photo) the image opens with only the Back to 3D chip.
 */
export function imageJumpHref(
  projectId: string,
  imageId: string,
  cloudId: string,
  spot: ImageSpot | null,
): string {
  const base = `/p/${projectId}/images/${encodeURIComponent(imageId)}`;
  const from = `from=cloud:${encodeURIComponent(cloudId)}`;
  if (!spot) return `${base}?${from}`;
  const r = Math.max(1, Math.round(spot.rpx));
  return `${base}?at=${f1(spot.px)},${f1(spot.py)}&r=${r}&${from}`;
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
