import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./tokens";

export interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "right";
  /** Milliseconds before it shows on hover; focus shows it at once. */
  delay?: number;
  className?: string;
}

/** Portal positioning stays outside scroll clipping and follows its anchor without animation. */
function FloatingLabel({
  label,
  id,
  side,
  anchor,
}: {
  label: ReactNode;
  id: string;
  side: NonNullable<TooltipProps["side"]>;
  anchor: React.RefObject<HTMLSpanElement>;
}) {
  const floating = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const element = floating.current;
    const target = anchor.current;
    if (!element || !target) return;
    const position = () => {
      const rect = target.getBoundingClientRect();
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      let left = side === "right" ? rect.right + 6 : rect.left + (rect.width - width) / 2;
      let top =
        side === "right"
          ? rect.top + (rect.height - height) / 2
          : side === "top"
            ? rect.top - height - 6
            : rect.bottom + 6;
      if (side === "right" && left + width > viewportWidth - 8) left = rect.left - width - 6;
      if (side === "top" && top < 8) top = rect.bottom + 6;
      if (side === "bottom" && top + height > viewportHeight - 8) top = rect.top - height - 6;
      element.style.left = `${Math.max(8, Math.min(left, viewportWidth - width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(top, viewportHeight - height - 8))}px`;
      element.style.visibility = "visible";
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(target);
    observer?.observe(element);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer?.disconnect();
    };
  }, [anchor, side, label]);
  return createPortal(
    <span
      ref={floating}
      role="tooltip"
      id={id}
      style={{ position: "fixed", visibility: "hidden" }}
      className="pointer-events-none z-50 w-max max-w-[calc(100vw-16px)] break-words rounded-md bg-inverse px-2 py-1 text-xs font-medium text-inverse-fg shadow-float"
    >
      {label}
    </span>,
    document.body,
  );
}

/** Disabled controls still receive hover explanations through the wrapping span. */
export function Tooltip({ label, children, side = "top", delay = 400, className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const focused = useRef(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const id = useId();
  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const show = (immediate: boolean) => {
    clearTimer();
    if (immediate) setOpen(true);
    else
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setOpen(true);
      }, delay);
  };
  const hide = () => {
    clearTimer();
    setOpen(false);
  };
  const child = isValidElement<{ "aria-describedby"?: string }>(children)
    ? cloneElement(children, {
        "aria-describedby": open
          ? [children.props["aria-describedby"], id].filter(Boolean).join(" ")
          : children.props["aria-describedby"],
      })
    : children;
  return (
    <span
      ref={anchor}
      className={cx("inline-flex", className)}
      onMouseEnter={() => show(false)}
      onMouseLeave={() => {
        clearTimer();
        if (!focused.current) setOpen(false);
      }}
      onFocus={() => {
        focused.current = true;
        show(true);
      }}
      onBlur={() => {
        focused.current = false;
        hide();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") hide();
      }}
      aria-describedby={open ? id : undefined}
    >
      {child}
      {open && <FloatingLabel label={label} id={id} side={side} anchor={anchor} />}
    </span>
  );
}
