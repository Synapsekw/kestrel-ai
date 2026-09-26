import { cx } from "./tokens";

export interface ProgressProps {
  /** 0 to 1; undefined draws an indeterminate bar. */
  value?: number;
  /** Adds the shimmer: the work behind the bar is running. */
  running?: boolean;
  label?: string;
  className?: string;
  /** 4px instead of 6px. */
  thin?: boolean;
}

/**
 * A job's progress. The fill is a full-width bar moved with translateX (motion stays on transform),
 * shimmering only while `running`; an indeterminate bar slides, and both stop under reduced motion.
 */
export function Progress({ value, running, label, className, thin }: ProgressProps) {
  const indeterminate = value === undefined;
  const pct =
    value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      className={cx(
        "relative w-full overflow-hidden rounded-chip bg-surface-2",
        thin ? "h-1" : "h-1.5",
        className,
      )}
    >
      {indeterminate ? (
        <div
          data-part="fill"
          className="animate-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-chip bg-accent"
        />
      ) : (
        <div
          data-part="fill"
          className={cx(
            "absolute inset-0 rounded-chip bg-accent transition-transform duration-base ease-out reduce-motion:transition-none",
            running && "animate-shimmer",
          )}
          style={{ transform: `translateX(${pct - 100}%)` }}
        />
      )}
    </div>
  );
}
