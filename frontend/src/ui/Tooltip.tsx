import { useId, useRef, useState, type ReactNode } from "react";
import { cx } from "./tokens";

export interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "right";
  /** Milliseconds before it shows on hover; focus shows it at once. */
  delay?: number;
  className?: string;
}

/**
 * A small label on hover and focus. Wraps its child in an inline-flex span so it also works around
 * disabled controls (which fire no pointer events themselves).
 */
export function Tooltip({ label, children, side = "top", delay = 400, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const id = useId();
  const show = (immediate: boolean) => {
    if (timer.current) window.clearTimeout(timer.current);
    if (immediate) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  };
  const pos =
    side === "top"
      ? "bottom-full left-1/2 mb-1.5 -translate-x-1/2"
      : side === "bottom"
        ? "top-full left-1/2 mt-1.5 -translate-x-1/2"
        : "left-full top-1/2 ml-1.5 -translate-y-1/2";
  return (
    <span
      className={cx("relative inline-flex", className)}
      onMouseEnter={() => show(false)}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cx(
            "pointer-events-none absolute z-30 whitespace-nowrap rounded-md bg-inverse px-2 py-1 text-xs font-medium text-inverse-fg shadow-float animate-[pop_120ms_ease-out_both] motion-reduce:animate-none",
            pos,
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
