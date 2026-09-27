import type { Vec3 } from "./types";

/** A drone photo's camera in the cloud's native CRS (C-L1 builds it from the cameras payload and
 * `photoLink.ts`'s frame): position, unit forward and up, the photo's FOVs and stored pixel size. */
export interface LookPose {
  position: Vec3;
  forward: Vec3;
  up: Vec3;
  hfovDeg: number;
  vfovDeg: number;
  width: number;
  height: number;
}

export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What `lookThrough` answers (plan Ruling 9). */
export interface LookThrough {
  /** Photo pixel (stored image, y down) → client coordinates on the canvas. */
  toCanvas(u: number, v: number): { x: number; y: number };
  /** The photo's frame on the canvas, in client coordinates. */
  frame(): ClientRectLike;
  /** Puts the camera back where it was before `lookThrough`. */
  restore(): void;
}

const tanHalf = (deg: number) => Math.tan((deg * Math.PI) / 360);

/**
 * The camera FOV that fits the photo inside the canvas (letterboxed), and `k`: canvas pixels per unit
 * of tangent. The photo spans tangents ±tan(hfov/2) × ±tan(vfov/2) (the photo-link pinhole, §10.3).
 */
export function letterbox(
  p: Pick<LookPose, "hfovDeg" | "vfovDeg">,
  canvasW: number,
  canvasH: number,
): { vfovDeg: number; k: number } {
  const k = Math.min(canvasW / 2 / tanHalf(p.hfovDeg), canvasH / 2 / tanHalf(p.vfovDeg));
  return { vfovDeg: (2 * Math.atan(canvasH / 2 / k) * 180) / Math.PI, k };
}

export function photoToCanvas(
  p: Pick<LookPose, "hfovDeg" | "vfovDeg" | "width" | "height">,
  rect: ClientRectLike,
  k: number,
  u: number,
  v: number,
): { x: number; y: number } {
  const tx = ((u - p.width / 2) / (p.width / 2)) * tanHalf(p.hfovDeg);
  const ty = -((v - p.height / 2) / (p.height / 2)) * tanHalf(p.vfovDeg);
  return { x: rect.left + rect.width / 2 + tx * k, y: rect.top + rect.height / 2 - ty * k };
}

export function photoFrame(
  p: Pick<LookPose, "hfovDeg" | "vfovDeg" | "width" | "height">,
  rect: ClientRectLike,
  k: number,
): ClientRectLike {
  const a = photoToCanvas(p, rect, k, 0, 0);
  const b = photoToCanvas(p, rect, k, p.width, p.height);
  return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
}

/** The vertical FOV of the largest 1.6 frame inside the on-screen view (R1's "Refresh view"). */
export function captureFovDeg(canvasAspect: number, vfovDeg: number, aspect = 1.6): number {
  if (canvasAspect >= aspect) return vfovDeg;
  const tanH = tanHalf(vfovDeg) * canvasAspect;
  return (2 * Math.atan(tanH / aspect) * 180) / Math.PI;
}
