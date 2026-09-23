import { chartLines } from "./chartPoints";
import type { SurveyTimeline } from "@/api/surveys";

const W = 560;
const H = 220;
const PAD = 24;
const SIZE = { w: W, h: H };

const shortDate = (iso: string | null) => (iso ? iso.slice(0, 10) : "date not set");

/** Counts per class over survey dates. Inline SVG in the style of the training curve: no library. */
export function SurveyChart({ timeline, hidden }: { timeline: SurveyTimeline; hidden: Set<string> }) {
  const lines = chartLines(timeline, SIZE).filter((l) => !hidden.has(l.classId));
  const top = Math.max(1, ...timeline.surveys.flatMap((s) => Object.values(s.counts)));
  const first = timeline.surveys[0];
  const last = timeline.surveys[timeline.surveys.length - 1];
  const anyHollow = timeline.surveys.some((s) => s.state !== "ok");
  return (
    <figure className="flex flex-col gap-1">
      <svg
        data-testid="survey-chart"
        role="img"
        aria-label={`Object counts for each survey, ${timeline.surveys.length} surveys`}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full max-w-xl"
      >
        {[0, 0.5, 1].map((v) => {
          const y = PAD + (1 - v) * (H - 2 * PAD);
          return (
            <g key={v}>
              <line x1={PAD} x2={W - PAD} y1={y} y2={y} className="stroke-line" strokeWidth={1} />
              <text x={2} y={y + 3} fontSize={9} className="fill-muted tabular-nums">
                {Math.round(v * top)}
              </text>
            </g>
          );
        })}
        {lines.map((l) => (
          <g key={l.classId}>
            <polyline points={l.points} fill="none" stroke={l.colour} strokeWidth={2} />
            {l.dots.map((d, i) => (
              // A hollow point was counted another way: drawn, but never differenced.
              <circle
                key={i}
                cx={d.x}
                cy={d.y}
                r={4}
                fill={d.comparable ? l.colour : "transparent"}
                stroke={l.colour}
                strokeWidth={2}
              />
            ))}
          </g>
        ))}
        <text x={PAD} y={H - 6} fontSize={9} className="fill-muted">
          {shortDate(first?.captured_on ?? null)}
        </text>
        <text x={W - PAD} y={H - 6} fontSize={9} className="fill-muted" textAnchor="end">
          {shortDate(last?.captured_on ?? null)}
        </text>
      </svg>
      <figcaption className="text-xs text-muted">
        Objects found in each survey.
        {anyHollow && " A hollow point was counted with another model or confidence, so it is not compared."}
      </figcaption>
    </figure>
  );
}
