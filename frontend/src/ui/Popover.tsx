import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { placeFloating, type Align, type Side } from "./floating";
import { GlassPanel } from "./GlassPanel";
import { cx } from "./tokens";
import { useFocusTrap } from "./useFocusTrap";

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement>;
  /** The panel's accessible name. */
  label: string;
  children: ReactNode;
  side?: Side;
  align?: Align;
  role?: "dialog" | "menu";
  initialFocusRef?: RefObject<HTMLElement>;
  className?: string;
}

function PopoverPanel({
  onClose,
  anchorRef,
  label,
  children,
  side = "bottom",
  align = "start",
  role = "dialog",
  initialFocusRef,
  className,
}: Omit<PopoverProps, "open">) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onTab = useFocusTrap(panelRef, true, initialFocusRef);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const place = () => {
      const at = placeFloating(
        anchor.getBoundingClientRect(),
        { width: panel.offsetWidth, height: panel.offsetHeight },
        side,
        align,
        {
          width: document.documentElement.clientWidth || window.innerWidth,
          height: document.documentElement.clientHeight || window.innerHeight,
        },
      );
      panel.style.left = `${at.left}px`;
      panel.style.top = `${at.top}px`;
      panel.dataset.side = at.side;
      panel.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorRef, side, align]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [anchorRef, onClose]);

  return createPortal(
    <GlassPanel
      ref={panelRef}
      variant="float"
      role={role}
      aria-label={label}
      tabIndex={-1}
      style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        onTab(e);
      }}
      className={cx(
        "z-50 max-h-[min(70vh,480px)] min-w-[180px] overflow-auto p-1.5 shadow-elev-2 outline-none animate-pop reduce-motion:animate-none",
        className,
      )}
    >
      {children}
    </GlassPanel>,
    document.body,
  );
}

/**
 * An anchored floating glass panel (layer pickers, type pickers, menus): focus-trapped, Escape and a
 * press outside close it, and focus returns to what had it (normally the anchor).
 */
export function Popover({ open, ...rest }: PopoverProps) {
  return open ? <PopoverPanel {...rest} /> : null;
}
