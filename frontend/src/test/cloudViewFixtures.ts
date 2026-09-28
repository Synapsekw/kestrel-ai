import type { CloudViewOut, CloudViewPose } from "@contract/client";
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import { CLOUD_ID } from "./cloudFixtures";

type T3 = [number, number, number];

/** A camera 10 m south and 10 m above the origin, looking at it; fov 60°. */
export const POSE: CloudViewPose = { position: [0, -10, 10], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 60 };

export function viewOut(over: Partial<CloudViewOut> = {}): CloudViewOut {
  return {
    subject_kind: "finding",
    subject_id: "f1",
    pose: { position: [0, -10, 10], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 50 },
    render: {
      colour_mode: "rgb",
      point_budget: 3_000_000,
      point_size: 1.4,
      edl: false,
      clip_box: null,
      complete: true,
    },
    anchor_normal: [0, 1, 0],
    sha256: "ab".repeat(32),
    bytes: 1000,
    width: 1600,
    height: 1000,
    captured_at: "2026-09-27T10:00:00Z",
    stale: false,
    ...over,
  };
}

export function measurementOf(
  kind: CloudMeasurement["kind"],
  pts: T3[],
  params: Record<string, unknown> | null = null,
  id = "m1",
): CloudMeasurement {
  return {
    id,
    point_cloud_id: CLOUD_ID,
    kind,
    name: `${kind} 1`,
    note: null,
    points: pts.map(([x, y, z], i) => ({ x, y, z, uncertainty_m: 0.02, group: i < 3 ? 0 : 1 })),
    results: {},
    params,
    status: "ready",
    error: null,
    job_id: null,
    finding_id: null,
    view: null,
    created_at: "2026-09-27T10:00:00Z",
    updated_at: "2026-09-27T10:00:00Z",
  } as unknown as CloudMeasurement;
}
