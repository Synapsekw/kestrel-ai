import type { CloudClipBox } from "@contract/client";

/** A native-CRS vector; structurally the same as C-V1's `Vec3`. */
export type V3 = readonly [number, number, number];

/**
 * What the per-frame pass needs from the viewer (plan x1 Ruling 6). `viewProj` is column-major (three's
 * `Matrix4.elements`) and maps origin-relative coordinates (P − origin) to clip space; `position` and
 * the pins are native. `width`/`height` are the canvas's CSS pixels.
 */
export interface PinCamera {
  viewProj: ArrayLike<number>;
  width: number;
  height: number;
  position: V3;
  origin: V3;
}

export interface PinClip {
  contains: (p: V3) => boolean;
  mode: CloudClipBox["mode"];
}

export type PinState = "hidden" | "back" | "visible";
/** `x`/`y` are canvas pixels; they are only meaningful when `state` is not `hidden`. */
export interface PinScreen {
  state: PinState;
  x: number;
  y: number;
}
export interface PinInput {
  p: V3;
  normal: V3 | null;
}

/** The mockup's `.pin.back` opacity. */
export const BACK_OPACITY = 0.38;

/** Spec C6: a drawn point more than this in front of the pin occludes it. */
export function occlusionTolerance(u: number): number {
  return Math.max(0.3, 3 * u);
}

/**
 * Spec §9.2: behind the camera or off the canvas (or outside the depth range) → hidden; outside the
 * clip box → hidden (show inside) or back (highlight inside); normal facing away → back.
 */
export function projectPin(
  p: V3,
  normal: V3 | null,
  cam: PinCamera,
  clip: PinClip | null = null,
  out: PinScreen = { state: "hidden", x: 0, y: 0 },
): PinScreen {
  const m = cam.viewProj;
  const x = p[0] - cam.origin[0];
  const y = p[1] - cam.origin[1];
  const z = p[2] - cam.origin[2];
  out.state = "hidden";
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (!(w > 0)) return out;
  const nx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  const ny = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  const nz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  if (nx < -1 || nx > 1 || ny < -1 || ny > 1 || nz < -1 || nz > 1) return out;
  let state: PinState = "visible";
  if (clip && !clip.contains(p)) {
    if (clip.mode === "show_inside") return out;
    state = "back";
  }
  if (normal) {
    const c = cam.position;
    if ((c[0] - p[0]) * normal[0] + (c[1] - p[1]) * normal[1] + (c[2] - p[2]) * normal[2] < 0) state = "back";
  }
  out.state = state;
  out.x = ((nx + 1) / 2) * cam.width;
  out.y = ((1 - ny) / 2) * cam.height;
  return out;
}

/** The whole pass: fills `out[i]` for `pins[i]` (growing `out` when it is short) and returns `out`. */
export function projectPins(
  pins: readonly PinInput[],
  cam: PinCamera,
  clip: PinClip | null,
  out: PinScreen[],
): PinScreen[] {
  for (let i = 0; i < pins.length; i++) {
    out[i] ??= { state: "hidden", x: 0, y: 0 };
    projectPin(pins[i].p, pins[i].normal, cam, clip, out[i]);
  }
  out.length = pins.length;
  return out;
}
