// The focus view of kit engine.js focusFinding: orthographic, along the patch direction or the pin
// normal, the view height from the profile's frustum fractions, turned off the surface by the
// oblique angle so depth (slabs, balconies) reads.
import type { Vec3 } from "./pins";

export interface FocusSettings {
  /** The view height as fractions of the asset height: [min, max]. */
  frustum: [number, number];
  oblique_deg: number;
}

export const DEFAULT_FOCUS: FocusSettings = { frustum: [0.05, 0.125], oblique_deg: 0 };

export interface FocusInput {
  kind: "patch" | "point";
  center: Vec3;
  normal: Vec3 | null;
  /** The patch's largest extent in metres; ignored for a pin. */
  size: number;
  /** The photo's camera, for a pin without a normal. */
  cameraPosition?: Vec3 | null;
}

export interface FocusView {
  target: Vec3;
  /** Unit vector from the target toward the camera. */
  direction: Vec3;
  /** The orthographic view's full height in metres. */
  viewHeight: number;
  distance: number;
}

const unit = (v: Vec3): Vec3 | null => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n < 1e-9 ? null : [v[0] / n, v[1] / n, v[2] / n];
};

function baseDirection(p: FocusInput): Vec3 {
  if (p.kind === "patch" && p.normal) {
    const d = unit(p.normal);
    if (d) return d;
  }
  let d: Vec3 | null = p.normal ? [...p.normal] : null;
  if (!d && p.cameraPosition) {
    d = [
      p.cameraPosition[0] - p.center[0],
      p.cameraPosition[1] - p.center[1],
      p.cameraPosition[2] - p.center[2],
    ];
  }
  if (d) {
    d[1] = Math.max(d[1], 0); // never look up from below the finding
    const u = unit(d);
    if (u) return u;
  }
  return unit([p.center[0], 0, p.center[2]]) ?? [1, 0, 0];
}

export function focusView(p: FocusInput, assetHeight: number, s: FocusSettings = DEFAULT_FOCUS): FocusView {
  const H = Math.max(assetHeight, 1);
  const extent = p.kind === "patch" ? Math.max(p.size, 0) : H * 0.02;
  const viewHeight = Math.max(H * s.frustum[0], Math.min(H * s.frustum[1], extent * 3.6));
  let direction = baseDirection(p);
  if (s.oblique_deg) {
    const a = (s.oblique_deg * Math.PI) / 180;
    const h = unit([direction[0], 0, direction[2]]);
    if (h) {
      // rotate the horizontal part by a about +Y (three.js applyAxisAngle), then tilt down by 0.55 a
      const x = h[0] * Math.cos(a) + h[2] * Math.sin(a);
      const z = -h[0] * Math.sin(a) + h[2] * Math.cos(a);
      direction = unit([x, Math.tan(a * 0.55), z]) ?? direction;
    }
  }
  return { target: [...p.center], direction, viewHeight, distance: H * 0.225 + 50 };
}
