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
import { KeyChord } from "./Kbd";
import { cx } from "./tokens";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  side?: TooltipSide;
  /** A chord ("B", "Shift+H", "Ctrl+K") shown as key caps after the label: "Box · B". */
  shortcut?: string;
  /** Milliseconds before it shows on hover; focus shows it at once. */
  delay?: number;
  className?: string;
}

/** Portal positioning stays outside scroll clipping and follows its anchor without animation. */
function FloatingLabel({
  label,
  shortcut,
  id,
  side,
  anchor,
}: {
  label: ReactNode;
  shortcut?: string;
  id: string;
  side: TooltipSide;
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
      const beside = side === "left" || side === "right";
      let left =
        side === "right"
          ? rect.right + 6
          : side === "left"
            ? rect.left - width - 6
            : rect.left + (rect.width - width) / 2;
      let top = beside
        ? rect.top + (rect.height - height) / 2
        : side === "top"
          ? rect.top - height - 6
          : rect.bottom + 6;
      if (side === "right" && left + width > viewportWidth - 8) left = rect.left - width - 6;
      if (side === "left" && left < 8) left = rect.right + 6;
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
      className="pointer-events-none z-50 inline-flex w-max max-w-[calc(100vw-16px)] items-center gap-2 break-words rounded-sm bg-tip px-2 py-1 text-xs font-medium text-tip-fg shadow-elev-2"
    >
      {label}
      {shortcut && <KeyChord chord={shortcut} />}
    </span>,
    document.body,
  );
}

/** Disabled controls still receive hover explanations through the wrapping span. */
export function Tooltip({ label, children, side = "top", shortcut, delay = 400, className }: TooltipProps) {
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
      {open && <FloatingLabel label={label} shortcut={shortcut} id={id} side={side} anchor={anchor} />}
    </span>
  );
}
