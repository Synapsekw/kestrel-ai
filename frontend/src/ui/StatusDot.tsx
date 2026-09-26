import { cx } from "./tokens";

/** Finding statuses, job states and the top bar's idle project (spec §4.1 status colours). */
export type DotStatus = "open" | "reviewed" | "closed" | "running" | "failed" | "idle";

const TONE: Record<DotStatus, string> = {
  open: "bg-accent ring-accent/25",
  reviewed: "bg-info ring-info/25",
  closed: "bg-ok ring-ok/25",
  idle: "bg-ok ring-ok/25",
  running: "bg-accent ring-accent/25",
  failed: "bg-danger ring-danger/25",
};

export interface StatusDotProps {
  status: DotStatus;
  /** Pulses, but only while `status` is running (a loop only while work runs). */
  live?: boolean;
  /** An accessible name; without one the dot is decorative (put the status in text beside it). */
  label?: string;
  className?: string;
}

export function StatusDot({ status, live = false, label, className }: StatusDotProps) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-status={status}
      className={cx(
        "inline-block h-2 w-2 shrink-0 rounded-full ring-[3px]",
        TONE[status],
        live && status === "running" && "animate-pulse-dot reduce-motion:animate-none",
        className,
      )}
    />
  );
}
