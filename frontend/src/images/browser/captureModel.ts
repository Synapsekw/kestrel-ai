import proj4 from "proj4";
import { fromLonLat } from "ol/proj";
import type { FlatStyle } from "ol/style/flat";
import type { GeoMap } from "@contract/client";
import { toOl } from "@/maps/grid";
import type { SeverityLevel } from "@/ui";
import type { BrowserSort } from "./filters";
import type { ImageIndexData } from "./useImageIndex";

/** Spec §7.5: 2.6 px with findings, 1.4 px without. */
export const POINT_RADIUS = { findings: 2.6, none: 1.4 } as const;
/** Hover tooltips at most 30 times a second. */
export const HOVER_THROTTLE_MS = 33;

export interface CapturePoint {
  ordinal: number;
  id: string;
  lon: number;
  lat: number;
  sev: number;
  count: number;
}

export function gpsPoints(index: ImageIndexData): CapturePoint[] {
  const out: CapturePoint[] = [];
  for (let i = 0; i < index.ids.length; i++) {
    const lon = index.lon[i];
    const lat = index.lat[i];
    if (lon === null || lat === null || lon === undefined || lat === undefined) continue;
    out.push({ ordinal: i, id: index.ids[i], lon, lat, sev: index.sev[i] ?? 0, count: index.count[i] ?? 0 });
  }
  return out;
}

function covers(b: readonly number[], lon: number, lat: number): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

/** §7.5: the newest ready ortho whose extent covers more than half the points; else none. */
export function pickBackground(maps: readonly GeoMap[], points: readonly CapturePoint[]): GeoMap | null {
  if (points.length === 0) return null;
  const usable = maps
    .filter((m) => m.status === "ready" && m.bounds_wgs84 && m.proj4 && m.geotransform)
    .sort((a, b) => (b.captured_on ?? b.created_at).localeCompare(a.captured_on ?? a.created_at));
  for (const m of usable) {
    const b = m.bounds_wgs84!;
    let inside = 0;
    for (const p of points) if (covers(b, p.lon, p.lat)) inside += 1;
    if (inside * 2 > points.length) return m;
  }
  return null;
}

/**
 * Deviation 1: with a covering ortho the view is the ortho's own pixel grid (the tile endpoint
 * serves that grid, not web mercator); without one it is EPSG:3857.
 */
export type ViewProjection = { kind: "ortho"; map: GeoMap } | { kind: "mercator" };

/** lon/lat → view coordinates. Ortho: `overview/heroPins.lonLatToMapPixel`'s maths, unclamped. */
export function projector(v: ViewProjection): (lon: number, lat: number) => number[] | null {
  if (v.kind === "mercator") return (lon, lat) => fromLonLat([lon, lat]);
  const m = v.map;
  const gt = m.geotransform;
  if (!gt || !m.proj4) return () => null;
  const toNative = proj4("EPSG:4326", m.proj4);
  const det = gt[1] * gt[5] - gt[2] * gt[4];
  if (!det) return () => null;
  return (lon, lat) => {
    const [x, y] = toNative.forward([lon, lat]) as [number, number];
    const px = (gt[5] * (x - gt[0]) - gt[2] * (y - gt[3])) / det;
    const py = (-gt[4] * (x - gt[0]) + gt[1] * (y - gt[3])) / det;
    return Number.isFinite(px) && Number.isFinite(py) ? toOl(px, py) : null;
  };
}

/** WebGL flat style: the worst severity's colour (grey when none), a bigger dot with findings. */
export function pointStyle(scale: readonly SeverityLevel[], noneColour: string): FlatStyle {
  const pairs: (string | number)[] = [...scale]
    .sort((a, b) => b.level - a.level)
    .flatMap((l) => [l.level, l.colour]);
  return {
    "circle-radius": ["case", [">", ["get", "count"], 0], POINT_RADIUS.findings, POINT_RADIUS.none],
    "circle-fill-color":
      pairs.length > 0
        ? (["match", ["get", "sev"], ...pairs, noneColour] as FlatStyle["circle-fill-color"])
        : noneColour,
  };
}

/** Ruling 11: the flight path only when the index is in capture order. */
export function flightPath(coords: readonly (number[] | null)[], sort: BrowserSort): number[][] | null {
  if (sort !== "capture_time") return null;
  const line = coords.filter((c): c is number[] => c !== null);
  return line.length >= 2 ? line : null;
}

export type FootprintKind = "trapezoid" | "wedge" | "point" | "none";

/** What FW passes from `ImageDetail` (I-BK: `footprint`, `footprint_kind`, `camera.gimbal_yaw`). */
export interface FootprintInput {
  kind: FootprintKind;
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "Point"; coordinates: number[] } | null;
  yawDeg: number | null;
}

export type FootprintShape =
  { kind: "polygon"; ring: number[][] } | { kind: "tick"; at: number[]; rotation: number } | null;

/** §7.4, drawing only: a trapezoid/wedge polygon, or a heading tick on a point footprint. */
export function footprintShape(
  fp: FootprintInput | null,
  project: (lon: number, lat: number) => number[] | null,
): FootprintShape {
  if (!fp || !fp.geometry || fp.kind === "none") return null;
  if (fp.geometry.type === "Polygon") {
    const ring = (fp.geometry.coordinates[0] ?? []).map(([lon, lat]) => project(lon, lat));
    if (ring.length < 4 || ring.some((c) => c === null)) return null;
    return { kind: "polygon", ring: ring as number[][] };
  }
  if (fp.yawDeg === null) return null;
  const [lon, lat] = fp.geometry.coordinates;
  const at = project(lon, lat);
  return at ? { kind: "tick", at, rotation: (fp.yawDeg * Math.PI) / 180 } : null;
}

export function idsInExtent(
  points: readonly CapturePoint[],
  coords: readonly (number[] | null)[],
  extent: readonly number[],
): string[] {
  const [x0, y0, x1, y1] = extent;
  const out: string[] = [];
  coords.forEach((c, i) => {
    if (c && c[0] >= x0 && c[0] <= x1 && c[1] >= y0 && c[1] <= y1) out.push(points[i].id);
  });
  return out;
}

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  /** Drops any pending trailing call, without firing it. The builder calls this from `destroy()`. */
  cancel(): void;
}

/**
 * Leading-edge throttle with a trailing call: the first call in a window fires immediately: a
 * later call inside the same window is remembered and fires once, at the end of the window, so a
 * pointer that moves fast and then stops mid-window (spec §7.5's hover) still gets its last
 * position delivered instead of being silently dropped.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
  now: () => number = () => performance.now(),
): Throttled<A> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const fire = (args: A) => {
    last = now();
    pending = null;
    fn(...args);
  };

  const throttled = ((...args: A) => {
    const remaining = ms - (now() - last);
    if (remaining <= 0) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      fire(args);
      return;
    }
    pending = args;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (pending) fire(pending);
      }, remaining);
    }
  }) as Throttled<A>;

  throttled.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  return throttled;
}
