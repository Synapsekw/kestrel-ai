import type { ReactNode } from "react";
import { GlassPanel } from "./GlassPanel";
import { Icon, type IconName } from "./Icon";
import { Sparkline } from "./Sparkline";
import { cx } from "./tokens";
import { useCountUp } from "./useCountUp";

export interface StatDelta {
  value: number;
  /** Which direction is good: "down" for open findings (fewer is better), "up" for reviewed. */
  good: "up" | "down";
  label?: string;
}

export interface StatTileProps {
  label: ReactNode;
  /** null: no data yet; shows a dash instead of counting to 0. */
  value: number | null;
  unit?: string;
  delta?: StatDelta;
  tone?: "default" | "accent" | "ok" | "danger";
  spark?: readonly number[];
  sparkLabel?: string;
  chips?: ReactNode;
  format?: (n: number) => string;
  icon?: IconName;
  className?: string;
}

const TONE = {
  default: "text-ink",
  accent: "text-accent-ink",
  ok: "text-ok",
  danger: "text-danger",
} as const;

function decimalsOf(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : Math.min(2, s.length - dot - 1);
}

function DeltaLine({ delta }: { delta: StatDelta }) {
  const good = delta.value === 0 ? null : delta.value > 0 === (delta.good === "up");
  const arrow = delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "•";
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
      <span className={good === null ? "text-muted" : good ? "text-ok" : "text-danger"}>
        {arrow} {Math.abs(delta.value).toLocaleString()}
      </span>
      {delta.label}
    </p>
  );
}

/** A dashboard figure (mockup .kpi): label, a counting value, a delta, chips and a sparkline. */
export function StatTile({
  label,
  value,
  unit,
  delta,
  tone = "default",
  spark,
  sparkLabel,
  chips,
  format,
  icon,
  className,
}: StatTileProps) {
  const target = value ?? 0;
  const shown = useCountUp(target);
  const digits = decimalsOf(target);
  const fmt =
    format ??
    ((n: number) =>
      n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return (
    <GlassPanel interactive className={cx("relative min-h-[112px] overflow-hidden px-4 py-3.5", className)}>
      <p className="flex items-center gap-1.5 text-xs text-muted">
        {icon && <Icon name={icon} size={14} />}
        {label}
      </p>
      <p className={cx("mt-2 text-kpi tabular-nums", TONE[tone])}>
        {value === null ? (
          <span aria-label="No data" className="text-dim">
            —
          </span>
        ) : (
          <>
            <span aria-hidden="true">{fmt(shown)}</span>
            <span className="sr-only">{fmt(target)}</span>
          </>
        )}
        {unit && value !== null && (
          <small className="ml-1 text-base font-medium tracking-normal text-muted">{unit}</small>
        )}
      </p>
      {delta && <DeltaLine delta={delta} />}
      {chips && <div className="mt-2 flex flex-wrap gap-1">{chips}</div>}
      {spark && spark.length > 0 && (
        <Sparkline values={spark} label={sparkLabel} className="absolute bottom-3 right-3" />
      )}
    </GlassPanel>
  );
}
