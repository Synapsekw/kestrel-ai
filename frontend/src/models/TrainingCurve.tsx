import { formatMetric } from "./modelLabels";
import { curvePolyline, type CurvePoint } from "./resultsCsv";

const W = 480;
const H = 200;
const PAD = 24;
const BOX = { width: W, height: H, pad: PAD };
const GRID = [0, 0.25, 0.5, 0.75, 1];

/** Inline SVG (no chart library): mAP50 solid accent, mAP50-95 dashed muted, y from 0 to 100 %. */
export function TrainingCurve({ points }: { points: CurvePoint[] }) {
  if (points.length === 0) {
    return (
      <p data-testid="training-curve-empty" className="text-xs text-muted">
        No epochs recorded in results.csv.
      </p>
    );
  }
  const last = points[points.length - 1];
  const map50 = curvePolyline(points, (p) => p.map50, BOX);
  const map5095 = curvePolyline(points, (p) => p.map50_95, BOX);
  return (
    <figure className="flex flex-col gap-1">
      <svg
        data-testid="training-curve"
        data-points={points.length}
        role="img"
        aria-label={`mAP50 over ${points.length} epochs, last ${formatMetric(last.map50)}`}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-xl"
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
        <polyline points={map50} fill="none" className="stroke-accent" strokeWidth={2} />
        {map5095 && (
          <polyline
            points={map5095}
            fill="none"
            className="stroke-muted"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}
        <text x={PAD} y={H - 6} fontSize={9} className="fill-muted">
          epoch {points[0].epoch}
        </text>
        <text x={W - PAD} y={H - 6} fontSize={9} className="fill-muted" textAnchor="end">
          epoch {last.epoch}
        </text>
      </svg>
      <figcaption className="text-xs text-muted">
        <span className="font-medium text-accent">mAP50</span> and{" "}
        <span className="font-medium text-ink">mAP50-95</span> (dashed) per epoch from results.csv (last:{" "}
        {formatMetric(last.map50)} / {formatMetric(last.map50_95)})
      </figcaption>
    </figure>
  );
}
