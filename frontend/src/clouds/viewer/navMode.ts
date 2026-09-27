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

/** The modes OrbitControls applies (fly is `flyControls.ts`). */
export type AppliedNavMode = Exclude<NavMode, "fly">;

/** Every mode applies: orbit and pan are OrbitControls button maps, fly is `flyControls.ts` (C-V2). */
export function resolveNavMode(requested: NavMode, current?: NavMode): NavMode {
  void current; // the planned (requested, current) arity; every mode applies whatever the current one
  return requested;
}

/** Orbit is S1's OrbitControls; pan swaps the buttons so a left drag pans (spec §7). */
export function mouseButtonsFor(mode: AppliedNavMode): MouseButtons {
  return mode === "pan"
    ? { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE }
    : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
}
