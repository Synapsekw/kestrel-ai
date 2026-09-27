import type { TrainingRun } from "@/api/trainingRuns";
import type { CurveBox, CurvePoint } from "@/library/resultsCsv";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

/** Series colours are tokens, never data: one per compared run, in selection order. */
export const SERIES_STROKE = ["stroke-accent", "stroke-ok", "stroke-info", "stroke-warn"];
export const SERIES_SWATCH = ["bg-accent", "bg-ok", "bg-info", "bg-warn"];

export function compareProblem(runs: Pick<TrainingRun, "model_id">[]): string | null {
  if (runs.length < MIN_COMPARE) return "Choose two to four runs to compare.";
  if (runs.length > MAX_COMPARE) return "Compare up to four runs at a time.";
  if (runs.filter((r) => r.model_id).length < MIN_COMPARE)
    return "At least two of the chosen runs need a finished model.";
  return null;
}

export function readCompare(params: URLSearchParams): string[] {
  return (params.get("compare") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPARE);
}

export interface EpochSpan {
  min: number;
  max: number;
}

export function epochSpan(series: CurvePoint[][]): EpochSpan | null {
  const epochs = series.flat().map((p) => p.epoch);
  if (epochs.length === 0) return null;
  return { min: Math.min(...epochs), max: Math.max(...epochs) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** mAP50 over a shared epoch axis, so runs of different length line up. */
export function overlayPolyline(points: CurvePoint[], span: EpochSpan, box: CurveBox): string {
  const w = box.width - 2 * box.pad;
  const h = box.height - 2 * box.pad;
  const range = Math.max(1, span.max - span.min);
  return points
    .map((p) => {
      const x = box.pad + ((p.epoch - span.min) / range) * w;
      const y = box.pad + (1 - Math.min(1, Math.max(0, p.map50))) * h;
      return `${round1(x)},${round1(y)}`;
    })
    .join(" ");
}
