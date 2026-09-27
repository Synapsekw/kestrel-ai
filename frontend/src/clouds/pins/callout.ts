import type { PinScreen, V3 } from "./project";

export const CALLOUT_WIDTH = 290;
export const CALLOUT_GAP = 30;
/** The inspector's column plus its gap: the card never passes `width − 360`. */
export const INSPECTOR_RESERVE = 360;
export const CALLOUT_TOP_MIN = 12;
export const CALLOUT_BOTTOM_RESERVE = 70;
export const ARROW_INSET = 14;

export interface CalloutPlacement {
  left: number;
  top: number;
  side: "right" | "left";
  /** The arrow's y inside the card, pointing at the pin. */
  arrowY: number;
}

/** Spec §9.3 placement (plan x1 Ruling 7). Null while the pin is hidden: the card hides with it. */
export function placeCallout(
  pin: PinScreen | null,
  cardHeight: number,
  canvas: { width: number; height: number },
): CalloutPlacement | null {
  if (!pin || pin.state === "hidden") return null;
  let side: CalloutPlacement["side"] = "right";
  let left = pin.x + CALLOUT_GAP;
  if (left + CALLOUT_WIDTH > canvas.width - INSPECTOR_RESERVE) {
    side = "left";
    left = Math.max(CALLOUT_TOP_MIN, pin.x - CALLOUT_GAP - CALLOUT_WIDTH);
  }
  const maxTop = Math.max(CALLOUT_TOP_MIN, canvas.height - cardHeight - CALLOUT_BOTTOM_RESERVE);
  const top = Math.min(maxTop, Math.max(CALLOUT_TOP_MIN, pin.y - cardHeight / 2));
  const arrowY = Math.min(cardHeight - ARROW_INSET, Math.max(ARROW_INSET, pin.y - top));
  return { left, top, side, arrowY };
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function compass8(azimuthDeg: number): (typeof COMPASS)[number] {
  return COMPASS[((Math.round(azimuthDeg / 45) % 8) + 8) % 8];
}

/** "Z 52.0 m · NE face" from z and the normal's horizontal part; "Z 52.0 m" without a usable bearing. */
export function locationLabel(z: number, normal: V3 | null): string {
  const base = `Z ${z.toFixed(1)} m`;
  if (!normal || Math.hypot(normal[0], normal[1]) < 0.25) return base;
  const az = ((Math.atan2(normal[0], normal[1]) * 180) / Math.PI + 360) % 360;
  return `${base} · ${compass8(az)} face`;
}
