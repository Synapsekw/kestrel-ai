import proj4 from "proj4";
import type { GeoMap } from "@contract/client";
import type { Finding } from "@/api/findings";
import { scaleBar } from "@/maps/grid";

/** F §9.1: the hero shows at most this many pins, most severe first. */
export const HERO_PIN_LIMIT = 300;
/** The no-map backdrop is laid out in this virtual box and placed by percentages. */
export const BACKDROP = { width: 800, height: 360, pad: 36 } as const;
const MIN_SPAN_M = 100;
const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON_EQ = 111_320;

export interface PinInput {
  id: string;
  number: number;
  severity: number | null;
  lon: number;
  lat: number;
}

export function pinsFromFindings(findings: readonly Finding[]): PinInput[] {
  return findings.flatMap((f) =>
    f.lon === null || f.lat === null
      ? []
      : [{ id: f.id, number: f.number, severity: f.severity, lon: f.lon, lat: f.lat }],
  );
}

/** WGS84 → the map's native CRS (proj4) → pixel (inverse geotransform); null off the map or without georeference. */
export function lonLatToMapPixel(
  m: Pick<GeoMap, "geotransform" | "proj4" | "width" | "height">,
  lon: number,
  lat: number,
): [number, number] | null {
  const gt = m.geotransform;
  if (!gt || !m.proj4) return null;
  const [x, y] = proj4("EPSG:4326", m.proj4).forward([lon, lat]) as [number, number];
  const det = gt[1] * gt[5] - gt[2] * gt[4];
  if (!det) return null;
  const px = (gt[5] * (x - gt[0]) - gt[2] * (y - gt[3])) / det;
  const py = (-gt[4] * (x - gt[0]) + gt[1] * (y - gt[3])) / det;
  if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px > m.width || py > m.height)
    return null;
  return [px, py];
}

/**
 * Pins without a map: a local equirectangular projection (metres) fitted into the virtual box,
 * aspect kept, at least `MIN_SPAN_M` across so one pin or coinciding pins sit in the middle.
 */
export function backdropLayout(pins: readonly PinInput[]): {
  points: { id: string; xPct: number; yPct: number }[];
  scale: { widthPct: number; label: string } | null;
} {
  if (pins.length === 0) return { points: [], scale: null };
  const lat0 = pins.reduce((n, p) => n + p.lat, 0) / pins.length;
  const kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  const xy = pins.map((p) => ({ id: p.id, x: p.lon * kx, y: p.lat * M_PER_DEG_LAT }));
  const minX = Math.min(...xy.map((p) => p.x));
  const maxX = Math.max(...xy.map((p) => p.x));
  const minY = Math.min(...xy.map((p) => p.y));
  const maxY = Math.max(...xy.map((p) => p.y));
  const spanX = Math.max(maxX - minX, MIN_SPAN_M);
  const spanY = Math.max(maxY - minY, MIN_SPAN_M);
  const innerW = BACKDROP.width - 2 * BACKDROP.pad;
  const innerH = BACKDROP.height - 2 * BACKDROP.pad;
  const pxPerM = Math.min(innerW / spanX, innerH / spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const points = xy.map((p) => ({
    id: p.id,
    xPct: ((BACKDROP.width / 2 + (p.x - cx) * pxPerM) / BACKDROP.width) * 100,
    yPct: ((BACKDROP.height / 2 - (p.y - cy) * pxPerM) / BACKDROP.height) * 100,
  }));
  // scaleBar works in "resolution × gsd": one virtual pixel is 1 / pxPerM metres = 100 / pxPerM cm.
  const bar = scaleBar(1, 100 / pxPerM, 120);
  return { points, scale: bar ? { widthPct: (bar.px / BACKDROP.width) * 100, label: bar.label } : null };
}
