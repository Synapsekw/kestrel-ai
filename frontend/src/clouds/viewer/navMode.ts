// frontend/src/clouds/viewer/navMode.ts
import type { NavMode } from "./types";

/** three's MOUSE values, written out so this module never loads three (navMode.test pins them). */
export const MOUSE = { ROTATE: 0, DOLLY: 1, PAN: 2 } as const;
export type MouseAction = (typeof MOUSE)[keyof typeof MOUSE];

export interface MouseButtons {
  LEFT: MouseAction;
  MIDDLE: MouseAction;
  RIGHT: MouseAction;
}

/** The modes V1 applies. */
export type AppliedNavMode = Exclude<NavMode, "fly">;

/** Fly is C-V2's: until then a request for it leaves the current mode in place (plan Ruling 2). */
export function resolveNavMode(requested: NavMode, current: AppliedNavMode): AppliedNavMode {
  return requested === "fly" ? current : requested;
}

/** Orbit is S1's OrbitControls; pan swaps the buttons so a left drag pans (spec §7). */
export function mouseButtonsFor(mode: AppliedNavMode): MouseButtons {
  return mode === "pan"
    ? { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
    : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
}
