/**
 * The asset findings map geometry (spec 2026-10-02-asset-findings §9): the TS twin of
 * backend/app/asset_review/findings_map.py. x is the side (compass bearing, or the faces relative to
 * the line), y is the height; layout from the kit's report findings map (viewBox 760 x 400). Both
 * twins are pinned by contract/fixtures/asset-findings-map.json, so the arithmetic below follows the
 * Python statement for statement.
 */

export const MAP_WIDTH = 760;
export const MAP_HEIGHT = 400;
const SIL_W = 64;
const LEFT = 110;
const RIGHT = 138;
const TOP = 10;
const BOTTOM = 38;
const PLOT_W = MAP_WIDTH - LEFT - RIGHT;
const PLOT_H = MAP_HEIGHT - TOP - BOTTOM;
const SIL_CX = SIL_W / 2 + 4;
const DOT_R = 5.5;
const COMPASS_TICKS: [string, number][] = [
  ["N", 0],
  ["E", 90],
  ["S", 180],
  ["W", 270],
  ["N", 360],
];

export interface MapZone {
  id: string;
  label: string;
  min_m: number | null;
  max_m: number | null;
}

/** The parts of `asset_model.review` the map reads; the contract's review type is assignable to it. */
export interface MapReview {
  sides: { type: "compass" | "faces"; labels: string[]; title: string };
  zones: MapZone[];
}

/** The parts of `asset_model.frame` the map reads. */
export interface MapFrame {
  height_m: number;
  north_offset_deg: number;
  /** Optional like the contract's AssetFrame, whose defaulted fields may be absent. */
  line_azimuth_deg?: number | null;
  silhouette?: number[][];
  levels?: number[];
}

export interface MapDot {
  id: string;
  height_m: number | null;
  /** Plant bearing, degrees clockwise from plant north. */
  bearing_deg: number | null;
  severity: number | null;
}

export interface MapGeometry {
  width: number;
  height: number;
  plot: { x: number; y: number; w: number; h: number };
  sil_cx: number;
  zone_label_x: number;
  dot_r: number;
  top_m: number;
  step_m: number;
  silhouette: number[][] | null;
  levels: { value: number; y: number; x1: number; x2: number }[];
  zones: { id: string; label: string; y: number; h: number; label_y: number; shade: boolean }[];
  y_ticks: { value: number; y: number }[];
  x_ticks: { label: string; x: number }[];
  axis_title: string;
  dots: { id: string; x: number; y: number; severity: number | null }[];
  unplaced: number;
}

/** Half up to 0.01, as `r2` in findings_map.py. */
export function r2(v: number): number {
  return Math.floor(v * 100 + 0.5) / 100;
}

/** [0, 360), as `norm_deg` in frame.py (JS `%` is C fmod, like math.fmod). */
export function normDeg(deg: number): number {
  let out = deg % 360;
  if (out < 0) out += 360;
  if (out >= 360) out = 0;
  return out + 0;
}

export function niceStep(heightM: number): number {
  const raw = heightM / 8;
  let p = 1;
  while (p * 10 <= raw) p *= 10;
  while (p > raw) p /= 10;
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function geometry(review: MapReview, frame: MapFrame, dots: MapDot[]): MapGeometry {
  // The frame arrives as a `Frame` dump (already sorted: silhouette by y, levels ascending), so no
  // sorting here, unlike the Python Frame validator.
  const frameSil = frame.silhouette ?? [];
  const frameLevels = frame.levels ?? [];
  const step = niceStep(frame.height_m);
  const top = Math.ceil(frame.height_m / step) * step;
  const yOf = (v: number) => TOP + (1 - Math.max(0, Math.min(top, v)) / top) * PLOT_H;

  const sil: [number, number][] =
    frameSil.length > 0 ? frameSil.map(([y, r]) => [y, r] as [number, number]) : [[0, 1]];
  const rmax = Math.max(...sil.map(([, r]) => r)) || 1;
  const k = Math.min(7, (SIL_W / 2 - 2) / rmax);
  const rAt = (h: number) => {
    let r = 0;
    for (const [y, rr] of sil) if (y <= h) r = rr;
    return r || sil[0][1];
  };

  let silhouette: number[][] | null = null;
  if (frameSil.length > 0) {
    const left = sil.map(([y, r]) => [r2(SIL_CX - r * k), r2(yOf(y))]);
    const right = [...sil].reverse().map(([y, r]) => [r2(SIL_CX + r * k), r2(yOf(y))]);
    silhouette = [...left, ...right];
  }
  const levels = frameLevels.map((lv) => ({
    value: lv,
    y: r2(yOf(lv)),
    x1: r2(SIL_CX - rAt(lv) * k - 3),
    x2: r2(SIL_CX + rAt(lv) * k + 3),
  }));
  const zones = review.zones.map((z, i) => {
    const a = z.min_m === null ? 0 : Math.max(0, z.min_m);
    const b = z.max_m === null ? top : Math.min(top, z.max_m);
    return {
      id: z.id,
      label: z.label,
      y: r2(yOf(b)),
      h: r2(Math.max(0, yOf(a) - yOf(b))),
      label_y: r2(yOf((a + b) / 2) + 4),
      shade: i % 2 === 0,
    };
  });
  const yTicks: { value: number; y: number }[] = [];
  for (let n = 0; n * step <= top + 1e-6; n += 1) yTicks.push({ value: r2(n * step), y: r2(yOf(n * step)) });

  const off = frame.north_offset_deg;
  let ticks: [string, number][];
  let rel: (b: number) => number;
  if (review.sides.type === "faces") {
    const labels = review.sides.labels;
    const az = frame.line_azimuth_deg ?? 0;
    ticks = [
      ...labels.map((lab, i) => [lab, (i * 360) / labels.length] as [string, number]),
      [labels[0], 360],
    ];
    rel = (b) => normDeg(b + off - az);
  } else {
    ticks = COMPASS_TICKS;
    rel = (b) => normDeg(b + off);
  }
  const xTicks = ticks.map(([label, b]) => ({ label, x: r2(LEFT + (b / 360) * PLOT_W) }));

  const placed = dots
    .filter(
      (d): d is MapDot & { height_m: number; bearing_deg: number } =>
        d.bearing_deg !== null && d.height_m !== null,
    )
    .sort((p, q) => (p.severity ?? 0) - (q.severity ?? 0) || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  return {
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    plot: { x: LEFT, y: TOP, w: PLOT_W, h: PLOT_H },
    sil_cx: SIL_CX,
    zone_label_x: LEFT + PLOT_W + 10,
    dot_r: DOT_R,
    top_m: r2(top),
    step_m: r2(step),
    silhouette,
    levels,
    zones,
    y_ticks: yTicks,
    x_ticks: xTicks,
    axis_title: review.sides.title,
    dots: placed.map((d) => ({
      id: d.id,
      x: r2(LEFT + (rel(d.bearing_deg) / 360) * PLOT_W),
      y: r2(yOf(d.height_m)),
      severity: d.severity,
    })),
    unplaced: dots.length - placed.length,
  };
}
