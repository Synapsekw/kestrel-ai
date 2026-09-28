import type { MouseEvent } from "react";
import { cx } from "@/ui";
import { formatLength } from "@/mapws/annotations/format";
import type { SeriesRole } from "@/mapws/annotations/pick";
import {
  PROFILE_BOX,
  cutFillPaths,
  exaggerationLabel,
  nearestStation,
  profileScales,
  seriesPath,
  type ChartBox,
  type Zs,
} from "./profileScales";

export interface ChartSeries {
  id: string;
  label: string;
  role: SeriesRole;
  z: Zs;
}

export interface ProfileChartProps {
  stations: readonly number[];
  /** In server order: series[0] is the cut/fill reference, series[1] the compared one (W3-6). */
  series: readonly ChartSeries[];
  /** The hovered station index, from the chart or from the map line. */
  cursor: number | null;
  onCursor?: (index: number | null) => void;
  box?: ChartBox;
  className?: string;
}

// Spec §9.2: left = blue, right = violet, design = dashed grey; cut red, fill teal (DESIGN.md tokens).
const STROKE: Record<SeriesRole, string> = {
  left: "stroke-info",
  right: "stroke-accent",
  design: "stroke-muted",
  other: "stroke-ink",
};
const DOT: Record<SeriesRole, string> = {
  left: "fill-info",
  right: "fill-accent",
  design: "fill-muted",
  other: "fill-ink",
};
const SWATCH: Record<SeriesRole, string> = {
  left: "bg-info",
  right: "bg-accent",
  design: "bg-muted",
  other: "bg-ink",
};

/** The elevation profile (spec §9.2): inline SVG in the pattern of surveys/SurveyChart.tsx, no library. */
export function ProfileChart({
  stations,
  series,
  cursor,
  onCursor,
  box = PROFILE_BOX,
  className,
}: ProfileChartProps) {
  const sc = profileScales(
    stations,
    series.map((s) => s.z),
    box,
  );
  if (!sc) return <p className="text-sm text-muted">No elevation along this line.</p>;
  const shade = series.length >= 2 ? cutFillPaths(stations, series[0].z, series[1].z, sc) : null;
  const at = cursor !== null && cursor >= 0 && cursor < stations.length ? cursor : null;
  const plotW = box.w - box.left - box.right;

  const move = (e: MouseEvent<SVGRectElement>) => {
    if (!onCursor) return;
    const rect = e.currentTarget.closest("svg")?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * box.w;
    onCursor(nearestStation(stations, ((vx - box.left) / plotW) * sc.sMax));
  };

  return (
    <figure className={cx("flex flex-col gap-1.5", className)}>
      <svg
        data-testid="profile-chart"
        role="img"
        aria-label={`Elevation profile along ${formatLength(sc.sMax)}, ${series.length} ${series.length === 1 ? "surface" : "surfaces"}`}
        viewBox={`0 0 ${box.w} ${box.h}`}
        className="w-full"
      >
        {sc.ticks.map((t) => (
          <g key={t}>
            <line
              x1={box.left}
              x2={box.w - box.right}
              y1={sc.y(t)}
              y2={sc.y(t)}
              className="stroke-line"
              strokeWidth={1}
            />
            <text
              x={box.left - 4}
              y={sc.y(t) + 3}
              fontSize={9}
              textAnchor="end"
              className="fill-muted font-mono tabular-nums"
            >
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        {shade && (
          <>
            <path data-testid="profile-cut" d={shade.cut} className="fill-danger" fillOpacity={0.28} />
            <path data-testid="profile-fill" d={shade.fill} className="fill-ok" fillOpacity={0.28} />
          </>
        )}
        {series.map((s) => (
          <path
            key={s.id}
            data-testid="profile-series"
            data-role={s.role}
            d={seriesPath(stations, s.z, sc)}
            fill="none"
            strokeWidth={1.75}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray={s.role === "design" ? "5 4" : undefined}
            className={STROKE[s.role]}
          />
        ))}
        <text x={box.w - box.right} y={box.top - 5} fontSize={9} textAnchor="end" className="fill-muted">
          {exaggerationLabel(sc.exaggeration)}
        </text>
        <text x={box.left} y={box.h - 6} fontSize={9} className="fill-muted font-mono tabular-nums">
          0 m
        </text>
        <text
          x={box.w - box.right}
          y={box.h - 6}
          fontSize={9}
          textAnchor="end"
          className="fill-muted font-mono tabular-nums"
        >
          {formatLength(sc.sMax)}
        </text>
        {at !== null && (
          <g data-testid="profile-cursor">
            <line
              x1={sc.x(stations[at])}
              x2={sc.x(stations[at])}
              y1={box.top}
              y2={box.h - box.bottom}
              className="stroke-ink"
              strokeOpacity={0.5}
              strokeWidth={1}
            />
            {series.map((s) => {
              const v = s.z[at];
              return typeof v === "number" && Number.isFinite(v) ? (
                <circle key={s.id} cx={sc.x(stations[at])} cy={sc.y(v)} r={3} className={DOT[s.role]} />
              ) : null;
            })}
          </g>
        )}
        <rect
          data-testid="profile-hit"
          x={box.left}
          y={box.top}
          width={plotW}
          height={box.h - box.top - box.bottom}
          fill="transparent"
          onMouseMove={move}
          onMouseLeave={() => onCursor?.(null)}
        />
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted">
        {series.map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={cx("h-0.5 w-3 rounded-full", SWATCH[s.role])} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
