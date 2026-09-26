import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./tokens";

export type PillTone = "neutral" | "ok" | "warn" | "danger" | "accent" | "info" | "inverse";

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  /** Adds a pulsing dot: something is running. */
  live?: boolean;
  /** A static dot in the tone colour. */
  dot?: boolean;
  size?: "sm" | "md";
  children: ReactNode;
}

const TONE: Record<PillTone, string> = {
  neutral: "bg-surface-2 text-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent-ink",
  info: "bg-info/15 text-info",
  // Kept for existing callers: the tooltip surface.
  inverse: "bg-tip text-tip-fg",
};

export function Pill({ tone = "neutral", live, dot, size = "md", className, children, ...rest }: PillProps) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip font-medium",
        size === "sm" ? "h-[18px] px-1.5 text-2xs" : "h-[22px] px-2.5 text-xs",
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {(live || dot) && (
        <span
          aria-hidden="true"
          className={cx(
            "h-1.5 w-1.5 rounded-full bg-current",
            live && "animate-pulse-dot reduce-motion:animate-none",
          )}
        />
      )}
      {children}
    </span>
  );
}
