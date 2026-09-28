/** Pure maths for ProfileChart (spec §9.2): chainage on x, height on y, NaN gaps as breaks. */

export interface ChartBox {
  w: number;
  h: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The inspector is 318 px wide; the chart's viewBox matches its content width. */
export const PROFILE_BOX: ChartBox = {
  w: 300,
  h: 170,
  left: 40,
  right: 8,
  top: 16,
  bottom: 20,
};
/** The expanded bottom sheet (spec §9.2 "Expand"). */
export const SHEET_BOX: ChartBox = {
  w: 1000,
  h: 240,
  left: 48,
  right: 12,
  top: 16,
  bottom: 22,
};

export type Zs = readonly (number | null)[];

export interface ProfileScales {
  x: (s: number) => number;
  y: (z: number) => number;
  sMax: number;
  zLo: number;
  zHi: number;
  ticks: number[];
  /** Metres of height per metre of chainage, as drawn. */
  exaggeration: number;
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function niceStep(range: number, count: number): number {
  const raw = range / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

export function profileScales(
  stations: readonly number[],
  series: readonly Zs[],
  box: ChartBox,
): ProfileScales | null {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const z of series)
    for (const v of z)
      if (finite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
  if (stations.length === 0 || !Number.isFinite(lo)) return null;
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const step = niceStep(hi - lo, 4);
  const zLo = Math.floor(lo / step) * step;
  const zHi = Math.ceil(hi / step) * step;
  const sMax = Math.max(stations[stations.length - 1] ?? 0, 1e-9);
  const plotW = box.w - box.left - box.right;
  const plotH = box.h - box.top - box.bottom;
  const ticks: number[] = [];
  for (let t = zLo; t <= zHi + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  return {
    x: (s) => box.left + (s / sMax) * plotW,
    y: (z) => box.top + ((zHi - z) / (zHi - zLo)) * plotH,
    sMax,
    zLo,
    zHi,
    ticks,
    exaggeration: plotH / (zHi - zLo) / (plotW / sMax),
  };
}

const pt = (sc: ProfileScales, s: number, z: number) => `${sc.x(s).toFixed(1)} ${sc.y(z).toFixed(1)}`;

/** One SVG path per series; a null or NaN height lifts the pen (a gap, never a drop to zero). */
export function seriesPath(stations: readonly number[], z: Zs, sc: ProfileScales): string {
  const parts: string[] = [];
  let pen = false;
  for (let i = 0; i < stations.length; i++) {
    const v = z[i];
    if (!finite(v) || !finite(stations[i])) {
      pen = false;
      continue;
    }
    parts.push(`${pen ? "L" : "M"}${pt(sc, stations[i], v)}`);
    pen = true;
  }
  return parts.join(" ");
}

/** Fill where `cur` is above `ref`, cut where below; a sign change splits the segment at the crossing. */
export function cutFillPaths(
  stations: readonly number[],
  ref: Zs,
  cur: Zs,
  sc: ProfileScales,
): { cut: string; fill: string } {
  const cut: string[] = [];
  const fill: string[] = [];
  const poly = (pts: [number, number][]) => `M${pts.map(([s, z]) => pt(sc, s, z)).join(" L")} Z`;
  for (let i = 0; i + 1 < stations.length; i++) {
    const s0 = stations[i];
    const s1 = stations[i + 1];
    const r0 = ref[i];
    const r1 = ref[i + 1];
    const c0 = cur[i];
    const c1 = cur[i + 1];
    if (!finite(r0) || !finite(r1) || !finite(c0) || !finite(c1)) continue;
    const d0 = c0 - r0;
    const d1 = c1 - r1;
    if (d0 === 0 && d1 === 0) continue;
    if (d0 * d1 >= 0) {
      (d0 + d1 > 0 ? fill : cut).push(
        poly([
          [s0, c0],
          [s1, c1],
          [s1, r1],
          [s0, r0],
        ]),
      );
      continue;
    }
    const t = d0 / (d0 - d1);
    const sx = s0 + t * (s1 - s0);
    const zx = r0 + t * (r1 - r0);
    (d0 > 0 ? fill : cut).push(
      poly([
        [s0, c0],
        [sx, zx],
        [s0, r0],
      ]),
    );
    (d1 > 0 ? fill : cut).push(
      poly([
        [sx, zx],
        [s1, c1],
        [s1, r1],
      ]),
    );
  }
  return { cut: cut.join(" "), fill: fill.join(" ") };
}

export function nearestStation(stations: readonly number[], s: number): number {
  let best = 0;
  for (let i = 1; i < stations.length; i++)
    if (Math.abs(stations[i] - s) < Math.abs(stations[best] - s)) best = i;
  return best;
}

export function exaggerationLabel(e: number): string {
  return `V.E. ×${e >= 10 ? Math.round(e) : e.toFixed(1)}`;
}
