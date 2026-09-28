import type { CloudCameraSet } from "@contract/client";
import {
  cameraBasis,
  NULL_Z_ABOVE_P99_M,
  type PhotoHit,
  type PhotoMethod,
  type V3,
} from "@/clouds/photoLink";
import type { Vec3 } from "@/clouds/viewer/camera";
import type { LookPose } from "@/clouds/viewer/lookThrough";
import type { OverlayShape } from "@/clouds/viewer/overlay";

/** Spec §10.2: the frustum rectangle sits 3 m ahead of the apex, in the accent colour at 65 %. */
export const GLYPH_DEPTH_M = 3;
export const GLYPH_OPACITY = 0.65;
export const GLYPH_POINT_PX = 7;
/** A click within 8 px of a projected camera centre opens its popover. */
export const GLYPH_HIT_PX = 8;
/** The high side of the plausibility check: median camera z above p99 + 1 000 m. */
export const HIGH_CAMERA_MARGIN_M = 1000;
export const OFFSET_MIN_M = -500;
export const OFFSET_MAX_M = 500;

const RAD = Math.PI / 180;

export type CamerasStatus = "idle" | "loading" | "ready" | "needs_coordinates" | "error";

/** C-X1 Ruling 5a: a frustum needs yaw, pitch and an altitude. */
export function isPosed(set: CloudCameraSet, i: number): boolean {
  return set.yaw[i] !== null && set.pitch[i] !== null && set.z[i] !== null;
}

export function posedCount(set: CloudCameraSet): number {
  let n = 0;
  for (let i = 0; i < set.image_id.length; i++) if (isPosed(set, i)) n++;
  return n;
}

/** A camera without altitude is drawn at the cloud's p99 + 30 m (spec §10.1), else the cloud top + 30 m. */
export function cameraZ(set: CloudCameraSet, i: number, fallbackTop: number): number {
  return set.z[i] ?? (set.z_p99 ?? fallbackTop) + NULL_Z_ABOVE_P99_M;
}

const at = (c: V3, f: V3, r: V3, up: V3, a: number, b: number): Vec3 => ({
  x: c[0] + GLYPH_DEPTH_M * f[0] + a * r[0] + b * up[0],
  y: c[1] + GLYPH_DEPTH_M * f[1] + a * r[1] + b * up[1],
  z: c[2] + GLYPH_DEPTH_M * f[2] + a * r[2] + b * up[2],
});

/**
 * The cameras as overlay shapes (spec §10.2): posed cameras as one `segments` shape (8 segments
 * each: apex to the four corners, then the rectangle), position-only cameras as one accent
 * `points` shape, and cameras without altitude as one warn `points` shape at `cameraZ`.
 */
export function glyphShapes(set: CloudCameraSet, fallbackTop: number): OverlayShape[] {
  const segs: Vec3[] = [];
  const plain: Vec3[] = [];
  const flagged: Vec3[] = [];
  for (let i = 0; i < set.image_id.length; i++) {
    const x = set.x[i];
    const y = set.y[i];
    if (isPosed(set, i)) {
      const c: V3 = [x, y, set.z[i]!];
      const { f, r, up } = cameraBasis(set.yaw[i]!, set.pitch[i]!, set.roll[i] ?? 0);
      const a = GLYPH_DEPTH_M * Math.tan((set.hfov[i] * RAD) / 2);
      const b = GLYPH_DEPTH_M * Math.tan((set.vfov[i] * RAD) / 2);
      const k = [
        at(c, f, r, up, -a, b),
        at(c, f, r, up, a, b),
        at(c, f, r, up, a, -b),
        at(c, f, r, up, -a, -b),
      ];
      const apex: Vec3 = { x, y, z: c[2] };
      for (let j = 0; j < 4; j++) segs.push(apex, k[j]);
      for (let j = 0; j < 4; j++) segs.push(k[j], k[(j + 1) % 4]);
    } else if (set.z[i] === null) {
      flagged.push({ x, y, z: cameraZ(set, i, fallbackTop) });
    } else {
      plain.push({ x, y, z: set.z[i]! });
    }
  }
  const out: OverlayShape[] = [];
  if (segs.length) out.push({ kind: "segments", points: segs, tone: "accent", opacity: GLYPH_OPACITY });
  if (plain.length) out.push({ kind: "points", points: plain, tone: "accent", size: GLYPH_POINT_PX });
  if (flagged.length) out.push({ kind: "points", points: flagged, tone: "warn", size: GLYPH_POINT_PX });
  return out;
}

const tuple = (v: V3): [number, number, number] => [v[0], v[1], v[2]];

/** A posed camera as C-V2's `LookPose` (cloud CRS, C-X1's frame, stored-image pixels); null when not posed. */
export function dronePose(set: CloudCameraSet, i: number): LookPose | null {
  if (!isPosed(set, i)) return null;
  const { f, up } = cameraBasis(set.yaw[i]!, set.pitch[i]!, set.roll[i] ?? 0);
  return {
    position: [set.x[i], set.y[i], set.z[i]!],
    forward: tuple(f),
    up: tuple(up),
    hfovDeg: set.hfov[i],
    vfovDeg: set.vfov[i],
    width: set.width[i],
    height: set.height[i],
  };
}

/** Spec §10.2: the median camera z is below the cloud's p50, or above its p99 + 1 000 m. */
export function heightsLookOff(set: CloudCameraSet, p50: number | null | undefined): boolean {
  if (p50 == null) return false;
  const zs = set.z.filter((z): z is number => z !== null).sort((a, b) => a - b);
  if (!zs.length) return false;
  const m = zs.length >> 1;
  const median = zs.length % 2 ? zs[m] : (zs[m - 1] + zs[m]) / 2;
  if (median < p50) return true;
  return set.z_p99 !== null && median > set.z_p99 + HIGH_CAMERA_MARGIN_M;
}

export function clampOffset(v: number): number {
  return Math.round(Math.min(OFFSET_MAX_M, Math.max(OFFSET_MIN_M, v)) * 10) / 10;
}

/** The local preview of an offset edit: that set's cameras move by (new − old); nothing is mutated. */
export function applyOffset(set: CloudCameraSet, sourceIdx: number, offsetM: number): CloudCameraSet {
  const source = set.sources[sourceIdx];
  if (!source) return set;
  const delta = offsetM - source.height_offset_m;
  return {
    ...set,
    z: set.z.map((z, i) => (z !== null && set.source_idx[i] === sourceIdx ? z + delta : z)),
    sources: set.sources.map((s, k) => (k === sourceIdx ? { ...s, height_offset_m: offsetM } : s)),
  };
}

/** The camera whose projected centre is nearest (cx, cy), within `maxPx`; null entries are off-screen. */
export function nearestCamera(
  screen: readonly ({ x: number; y: number } | null)[],
  cx: number,
  cy: number,
  maxPx = GLYPH_HIT_PX,
): number | null {
  let best: number | null = null;
  let bestD = maxPx;
  screen.forEach((p, i) => {
    if (!p) return;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d <= bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** Why the "Show camera positions" switch is disabled, or null when it is not (spec §14). */
export function disabledReason(
  status: CamerasStatus,
  set: CloudCameraSet | null,
  error: string | null,
): string | null {
  if (status === "needs_coordinates") return "Assign a CRS to place the drone photos";
  if (status === "error") return `Could not load the drone photos: ${error ?? "unknown error"}`;
  if (!set) return "Loading the drone photos…";
  if (set.image_id.length === 0) return "No photos near this cloud";
  return null;
}

export function methodLabel(m: PhotoMethod): string {
  return m === "frustum" ? "In frame" : "By distance";
}

/** Controller ruling 6: the one place "photo(s)" is pluralised (the toast, the panel row, the list). */
export function photoCount(n: number): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? "photo" : "photos"}`;
}

/** Spec §10.3: "14 photos saw this point · DJI_0712 closest (9.4 m)". */
export function photoLinkMessage(total: number, fileName: string | null, distanceM: number | null): string {
  if (total === 0 || distanceM === null) return "No photo saw this point";
  const d = distanceM.toFixed(1);
  return fileName
    ? `${photoCount(total)} saw this point · ${fileName} closest (${d} m)`
    : `${photoCount(total)} saw this point (${d} m away)`;
}

/** Controller ruling 6: the one place a `PhotoHit` becomes `imageJumpHref`'s spot; null for a distance hit. */
export function spotOf(hit: PhotoHit): { px: number; py: number; rpx: number } | null {
  return hit.px !== null && hit.py !== null && hit.rpx !== null
    ? { px: hit.px, py: hit.py, rpx: hit.rpx }
    : null;
}
