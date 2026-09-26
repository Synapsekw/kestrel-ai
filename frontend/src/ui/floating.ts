export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";

export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/**
 * Where a floating panel of `size` goes next to `anchor`: on `side` if it fits, else on the opposite
 * side if that fits, else on `side` anyway; aligned along the other axis; clamped `margin` px inside
 * the viewport. Pure, so Popover, Tooltip and their tests share it.
 */
export function placeFloating(
  anchor: AnchorRect,
  size: { width: number; height: number },
  side: Side,
  align: Align,
  viewport: { width: number; height: number },
  gap = 6,
  margin = 8,
): { left: number; top: number; side: Side } {
  const fits = (s: Side) =>
    s === "bottom"
      ? anchor.bottom + gap + size.height <= viewport.height - margin
      : s === "top"
        ? anchor.top - gap - size.height >= margin
        : s === "right"
          ? anchor.right + gap + size.width <= viewport.width - margin
          : anchor.left - gap - size.width >= margin;
  const chosen = fits(side) || !fits(OPPOSITE[side]) ? side : OPPOSITE[side];
  let left: number;
  let top: number;
  if (chosen === "top" || chosen === "bottom") {
    top = chosen === "bottom" ? anchor.bottom + gap : anchor.top - gap - size.height;
    left =
      align === "start"
        ? anchor.left
        : align === "end"
          ? anchor.right - size.width
          : anchor.left + (anchor.width - size.width) / 2;
  } else {
    left = chosen === "right" ? anchor.right + gap : anchor.left - gap - size.width;
    top =
      align === "start"
        ? anchor.top
        : align === "end"
          ? anchor.bottom - size.height
          : anchor.top + (anchor.height - size.height) / 2;
  }
  const clamp = (v: number, limit: number) => Math.max(margin, Math.min(v, limit - margin));
  return {
    left: clamp(left, viewport.width - size.width),
    top: clamp(top, viewport.height - size.height),
    side: chosen,
  };
}
