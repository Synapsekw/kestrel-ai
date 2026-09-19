import { cx } from "./tokens";

export interface ProgressProps {
  /** 0 to 1; undefined draws an indeterminate bar. */
  value?: number;
  /** Adds the shimmer: the work behind the bar is running. */
  running?: boolean;
  label?: string;
  className?: string;
  /** Height in Tailwind units; 1.5 (6px) by default. */
  thin?: boolean;
}

export function Progress({ value, running, label, className, thin }: ProgressProps) {
  const indeterminate = value === undefined;
  const pct = indeterminate ? 40 : Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      className={cx("w-full overflow-hidden rounded-full bg-well", thin ? "h-1" : "h-1.5", className)}
    >
      <div
        className={cx(
          "h-full rounded-full bg-accent transition-[width] duration-220 ease-out motion-reduce:transition-none",
          running &&
            "bg-[linear-gradient(90deg,rgb(var(--accent))_0%,rgb(var(--accent-hover))_45%,rgb(var(--accent))_100%),linear-gradient(90deg,transparent,rgb(255_255_255/0.35),transparent)] bg-[length:100%_100%,200%_100%] animate-shimmer motion-reduce:animate-none",
          indeterminate && "animate-[shimmer_1.2s_linear_infinite] motion-reduce:animate-none",
        )}
        style={indeterminate ? { width: `${pct}%`, marginLeft: "30%" } : { width: `${pct}%` }}
      />
    </div>
  );
}
