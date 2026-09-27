import type { CloudCameraSet } from "@contract/client";

/** A native-CRS vector; structurally the same as C-V1's `Vec3`. */
export type V3 = readonly [number, number, number];
export type PhotoMethod = "frustum" | "distance";

export interface PhotoHit {
  /** Index into the cameras payload's arrays. */
  index: number;
  imageId: string;
  method: PhotoMethod;
  distanceM: number;
  /** Lower is better: d·(1 + 0.5ρ²) for a frustum hit, d for a distance hit. */
  score: number;
  /** Stored-image pixels (`image.width/height` space), clamped to the frame; null for a distance hit. */
  px: number | null;
  py: number | null;
  /** The spot ring radius in stored-image pixels, at least 12; null for a distance hit. */
  rpx: number | null;
  /** The camera had no altitude and was placed at z_p99 + 30 m. */
  zAssumed: boolean;
}

export interface PhotoLinkResult {
  /** Frustum hits by score, then distance hits by score, at most `cap`. */
  hits: PhotoHit[];
  /** Every accepted camera before the cap. */
  total: number;
}

export const PHOTO_LINK_CAP = 50;
export const MIN_RING_PX = 12;
export const GIMBAL_TOLERANCE_DEG = 2;
export const FACING_SLACK = 0.05;
export const NULL_Z_ABOVE_P99_M = 30;
export const MIN_FALLBACK_RADIUS_M = 30;

const RAD = Math.PI / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * The camera frame in ENU for grid yaw ψ (clockwise from grid north), pitch θ (−90 nadir) and roll φ:
 * f = (sin ψ cos θ, cos ψ cos θ, sin θ); r₀ = (cos ψ, −sin ψ, 0) rotated about f by +φ (a positive roll
 * lowers the image's right side, plan x1 Ruling 5f); up = r × f.
 */
export function cameraBasis(yawDeg: number, pitchDeg: number, rollDeg: number): { f: V3; r: V3; up: V3 } {
  const psi = yawDeg * RAD;
  const th = pitchDeg * RAD;
  const phi = rollDeg * RAD;
  const f: V3 = [Math.sin(psi) * Math.cos(th), Math.cos(psi) * Math.cos(th), Math.sin(th)];
  const r0: V3 = [Math.cos(psi), -Math.sin(psi), 0];
  const fx = cross(f, r0);
  const k = dot(f, r0) * (1 - Math.cos(phi));
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  const r: V3 = [
    r0[0] * c + fx[0] * s + f[0] * k,
    r0[1] * c + fx[1] * s + f[1] * k,
    r0[2] * c + fx[2] * s + f[2] * k,
  ];
  return { f, r, up: cross(r, f) };
}

const byScore = (a: PhotoHit, b: PhotoHit) => a.score - b.score || a.index - b.index;

/**
 * Spec §10.3 / C7: one O(n) scan over the cameras payload. Posed cameras (yaw, pitch and z known) get
 * the frustum test with an angular tolerance; the others get the distance fallback. With a surface
 * normal, a camera the surface faces away from is rejected first.
 */
export function photosSeeing(
  pick: { x: number; y: number; z: number },
  normal: V3 | null,
  cams: CloudCameraSet,
  cap: number = PHOTO_LINK_CAP,
): PhotoLinkResult {
  const len = normal ? Math.hypot(normal[0], normal[1], normal[2]) : 0;
  const n: V3 | null = normal && len > 0 ? [normal[0] / len, normal[1] / len, normal[2] / len] : null;
  const zFallback = (cams.z_p99 ?? pick.z) + NULL_Z_ABOVE_P99_M;
  const posed: PhotoHit[] = [];
  const byDistance: PhotoHit[] = [];
  for (let i = 0; i < cams.image_id.length; i++) {
    const zRaw = cams.z[i];
    const cz = zRaw ?? zFallback;
    const v: V3 = [pick.x - cams.x[i], pick.y - cams.y[i], pick.z - cz];
    const d = Math.hypot(v[0], v[1], v[2]);
    if (n && dot(v, n) > -FACING_SLACK * d) continue;
    const yaw = cams.yaw[i];
    const pitch = cams.pitch[i];
    if (yaw !== null && pitch !== null && zRaw !== null) {
      const { f, r, up } = cameraBasis(yaw, pitch, cams.roll[i] ?? 0);
      const vf = dot(v, f);
      if (vf <= 0) continue;
      const x = dot(v, r) / vf;
      const y = dot(v, up) / vf;
      const alpha = Math.atan(cams.sigma_m[i] / d) + GIMBAL_TOLERANCE_DEG * RAD;
      const hh = (cams.hfov[i] * RAD) / 2;
      const vh = (cams.vfov[i] * RAD) / 2;
      if (Math.abs(Math.atan(x)) > hh + alpha || Math.abs(Math.atan(y)) > vh + alpha) continue;
      const W = cams.width[i];
      const H = cams.height[i];
      const kx = W / 2 / Math.tan(hh);
      const ky = H / 2 / Math.tan(vh);
      const px = W / 2 + x * kx;
      const py = H / 2 - y * ky;
      const rho2 = (((px - W / 2) / (W / 2)) ** 2 + ((py - H / 2) / (H / 2)) ** 2) / 2;
      posed.push({
        index: i,
        imageId: cams.image_id[i],
        method: "frustum",
        distanceM: d,
        score: d * (1 + 0.5 * rho2),
        px: Math.min(W, Math.max(0, px)),
        py: Math.min(H, Math.max(0, py)),
        rpx: Math.max(MIN_RING_PX, Math.tan(alpha) * kx),
        zAssumed: false,
      });
    } else {
      const horizontal = Math.hypot(v[0], v[1]);
      if (horizontal > Math.max(MIN_FALLBACK_RADIUS_M, 1.5 * Math.abs(cz - pick.z))) continue;
      byDistance.push({
        index: i,
        imageId: cams.image_id[i],
        method: "distance",
        distanceM: d,
        score: d,
        px: null,
        py: null,
        rpx: null,
        zAssumed: zRaw === null,
      });
    }
  }
  posed.sort(byScore);
  byDistance.sort(byScore);
  return { hits: [...posed, ...byDistance].slice(0, cap), total: posed.length + byDistance.length };
}
