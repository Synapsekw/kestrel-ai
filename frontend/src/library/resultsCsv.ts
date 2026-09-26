export interface CurvePoint {
  epoch: number;
  map50: number;
  map50_95: number | null;
}

const EPOCH = "epoch";
const MAP50 = "metrics/mAP50(B)";
const MAP50_95 = "metrics/mAP50-95(B)";

/** Ultralytics `results.csv`: one row per epoch; header cells may carry padding in older versions. */
export function parseResultsCsv(text: string): CurvePoint[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const iEpoch = header.indexOf(EPOCH);
  const iMap50 = header.indexOf(MAP50);
  const iMap5095 = header.indexOf(MAP50_95);
  if (iEpoch < 0 || iMap50 < 0) return [];
  const points: CurvePoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const epoch = Number(cells[iEpoch]);
    const map50 = Number(cells[iMap50]);
    if (!Number.isFinite(epoch) || !Number.isFinite(map50)) continue;
    const m95 = iMap5095 >= 0 ? Number(cells[iMap5095]) : Number.NaN;
    points.push({ epoch, map50, map50_95: Number.isFinite(m95) ? m95 : null });
  }
  return points;
}

export interface CurveBox {
  width: number;
  height: number;
  pad: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** SVG `points` for a metric over epochs: x spans the epoch range, y maps 1 to the top and 0 to the bottom. */
export function curvePolyline(
  points: CurvePoint[],
  pick: (p: CurvePoint) => number | null,
  box: CurveBox,
): string {
  if (points.length === 0) return "";
  const minEpoch = points[0].epoch;
  const span = Math.max(1, points[points.length - 1].epoch - minEpoch);
  const w = box.width - 2 * box.pad;
  const h = box.height - 2 * box.pad;
  return points
    .flatMap((p) => {
      const v = pick(p);
      if (v === null) return [];
      const x = box.pad + ((p.epoch - minEpoch) / span) * w;
      const y = box.pad + (1 - Math.min(1, Math.max(0, v))) * h;
      return [`${round1(x)},${round1(y)}`];
    })
    .join(" ");
}
