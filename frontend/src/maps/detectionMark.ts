/** How a detection is drawn at a given zoom (spec 2026-09-23 section 7).
 *
 * Boxes live in map-pixel space, so they shrink with the view: on an 86 904 px map fitted to the
 * pane, even a correctly-scaled 9 m machine is under 5 screen px. Below the floor the box is held
 * at a constant on-screen size instead of vanishing.
 */
export type Mark = "clamped" | "box" | "labelled";

/** Smallest a detection is ever drawn, in CSS pixels. */
export const MIN_SCREEN_PX = 14;
/** Size at which a class name fits beside the box without crowding it. */
export const LABEL_SCREEN_PX = 40;

export function markFor(w: number, h: number, resolution: number): Mark {
  const screen = resolution > 0 ? Math.max(w, h) / resolution : Number.POSITIVE_INFINITY;
  if (screen < MIN_SCREEN_PX) return "clamped";
  return screen < LABEL_SCREEN_PX ? "box" : "labelled";
}
