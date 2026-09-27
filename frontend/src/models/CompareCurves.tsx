import type { TrainingRun } from "@/api/trainingRuns";
import { formatMetric } from "@/library/modelLabels";
import type { CurvePoint } from "@/library/resultsCsv";
import { cx } from "@/ui";
import { SERIES_STROKE, SERIES_SWATCH, epochSpan, overlayPolyline } from "./compareModel";
import { useResultsCurves } from "./useResultsCurve";

const W = 480;
const H = 220;
const PAD = 24;
const BOX = { width: W, height: H, pad: PAD };
const GRID = [0, 0.25, 0.5, 0.75, 1];

/** mAP50 of 2–4 runs on one axis, from each model's `results.csv` (F §12.4 Compare). */
export function CompareCurves({ runs }: { runs: TrainingRun[] }) {
  const modelIds = runs.map((r) => r.model_id).filter((id): id is string => Boolean(id));
  const curves = useResultsCurves(modelIds);
  const series = runs.map((r, i) => {
    const c = r.model_id ? curves[r.model_id] : undefined;
    const points: CurvePoint[] = c && c.state === "ready" ? c.points : [];
    return { run: r, points, index: i };
  });
  const span = epochSpan(series.map((s) => s.points));

  return (
    <figure className="flex flex-col gap-3">
      <svg
        role="img"
        aria-label={`mAP50 of ${runs.length} runs over epochs`}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-2xl"
      >
        {GRID.map((v) => {
          const y = PAD + (1 - v) * (H - 2 * PAD);
          return (
            <g key={v}>
              <line x1={PAD} x2={W - PAD} y1={y} y2={y} className="stroke-line" strokeWidth={1} />
              <text x={2} y={y + 3} fontSize={9} className="fill-muted tabular-nums">
                {Math.round(v * 100)}%
              </text>
            </g>
          );
        })}
        {span &&
          series
            .filter((s) => s.points.length > 0)
            .map((s) => (
              <polyline
                key={s.run.id}
                data-run={s.run.id}
                points={overlayPolyline(s.points, span, BOX)}
                fill="none"
                strokeWidth={2}
                className={SERIES_STROKE[s.index % SERIES_STROKE.length]}
              />
            ))}
      </svg>
      <ul className="flex flex-col gap-1.5 text-sm">
        {series.map((s) => {
          const last = s.points.length > 0 ? s.points[s.points.length - 1] : undefined;
          return (
            <li key={s.run.id} className="flex items-center gap-2">
              <span
                aria-hidden
                className={cx("h-2 w-4 rounded-chip", SERIES_SWATCH[s.index % SERIES_SWATCH.length])}
              />
              <span className="min-w-0 flex-1 truncate">{s.run.name}</span>
              <span className="font-mono tabular-nums text-muted">
                {last ? formatMetric(last.map50) : "no curve yet"}
              </span>
            </li>
          );
        })}
      </ul>
    </figure>
  );
}
