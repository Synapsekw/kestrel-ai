/* eslint-disable react-refresh/only-export-components --
   the path helper is exported next to the component for its tests; not a fast-refresh boundary. */
import { useId } from "react";
import { useReducedMotion } from "./motion";
import { cx } from "./tokens";

/** A sparkline draws at most this many points: the last 60 (spec §4.4). */
export const SPARK_MAX = 60;

/** Line and area paths for the last SPARK_MAX finite values, scaled into width × height. */
export function sparkPaths(
  values: readonly number[],
  width: number,
  height: number,
  pad = 2,
): { line: string; area: string } | null {
  const finite = values.filter(Number.isFinite).slice(-SPARK_MAX);
  if (finite.length === 0) return null;
  const pts = finite.length === 1 ? [finite[0], finite[0]] : finite;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min;
  const round = (n: number) => Math.round(n * 100) / 100;
  const x = (i: number) => round(pad + (i * (width - 2 * pad)) / (pts.length - 1));
  const y = (n: number) => round(span === 0 ? height / 2 : pad + ((max - n) * (height - 2 * pad)) / span);
  const line = pts.map((n, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(n)}`).join(" ");
  const area = `${line} L${x(pts.length - 1)} ${height} L${x(0)} ${height} Z`;
  return { line, area };
}

export interface SparklineProps {
  values: readonly number[];
  width?: number;
  height?: number;
  label?: string;
  className?: string;
}

/** An accent line over a faint area (mockup .spark). It draws in by growing a clip rectangle. */
export function Sparkline({ values, width = 90, height = 32, label, className }: SparklineProps) {
  const reduced = useReducedMotion();
  const clipId = `spark-${useId().replace(/:/g, "")}`;
  const paths = sparkPaths(values, width, height);
  if (!paths) return null;
  const latest = values.filter(Number.isFinite).at(-1);
  return (
    <svg
      role="img"
      aria-label={label ?? `Trend, latest ${latest}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cx("overflow-visible", className)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect
            data-part="clip"
            width={width}
            height={height}
            className={reduced ? undefined : "spark-draw"}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <path d={paths.area} className="fill-accent opacity-[.12]" />
        <path
          d={paths.line}
          className="fill-none stroke-accent"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
