import { chartLines } from "./chartPoints";
import type { SurveyTimeline } from "@/api/surveys";

const SIZE = { w: 640, h: 220 };

/** Counts per class over survey dates. Inline SVG, like the training curve: no chart library. */
export function SurveyChart({ timeline, hidden }: { timeline: SurveyTimeline; hidden: Set<string> }) {
  const lines = chartLines(timeline, SIZE).filter((l) => !hidden.has(l.classId));
  return (
    <svg
      viewBox={`0 0 ${SIZE.w} ${SIZE.h}`}
      className="w-full"
      role="img"
      aria-label="Object counts for each survey"
    >
      {lines.map((l) => (
        <g key={l.classId}>
          <polyline points={l.points} fill="none" stroke={l.colour} strokeWidth={2} />
          {l.dots.map((d, i) => (
            // A hollow point was counted another way, so it is drawn but never differenced.
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
    </svg>
  );
}
