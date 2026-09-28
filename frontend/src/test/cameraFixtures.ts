import type { CloudCameraSet } from "@contract/client";

export const SOURCE_A = "s0000000-3333-4000-8000-00000000000a";

export interface TestCam {
  id?: string;
  x: number;
  y: number;
  z: number | null;
  yaw?: number | null;
  pitch?: number | null;
  roll?: number | null;
  hfov?: number;
  vfov?: number;
  w?: number;
  h?: number;
  source?: number;
}

const posed = (c: TestCam) => c.yaw != null && c.pitch != null;

/** A `CloudCameraSet` from a few cameras: one image set, 2048 × 1536 frames, 73.7° × 53.1°, σ 3 m. */
export function cameraSet(cams: TestCam[], extra: Partial<CloudCameraSet> = {}): CloudCameraSet {
  return {
    image_id: cams.map((c, i) => c.id ?? `img-${i}`),
    source_idx: cams.map((c) => c.source ?? 0),
    x: cams.map((c) => c.x),
    y: cams.map((c) => c.y),
    z: cams.map((c) => c.z),
    yaw: cams.map((c) => (posed(c) ? c.yaw! : null)),
    pitch: cams.map((c) => (posed(c) ? c.pitch! : null)),
    roll: cams.map((c) => (posed(c) ? (c.roll ?? 0) : null)),
    hfov: cams.map((c) => c.hfov ?? 73.7),
    vfov: cams.map((c) => c.vfov ?? 53.1),
    fov_assumed: cams.map(() => false),
    width: cams.map((c) => c.w ?? 2048),
    height: cams.map((c) => c.h ?? 1536),
    sigma_m: cams.map(() => 3),
    sources: [
      {
        id: SOURCE_A,
        label: "Flight 14 Sep",
        count: cams.length,
        height_offset_m: 0,
        posed_count: cams.filter(posed).length,
      },
    ],
    truncated: false,
    z_p1: 0.02,
    z_p99: 1.98,
    without_gps: 0,
    ...extra,
  };
}
