import type { CloudViewOut } from "@contract/client";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import type { Vec3 } from "@/clouds/viewer/types";

/** Ruling 11 / spec §9.4 "Fly to … else lookAt(P, 20 m)". */
export const FLY_TO_DISTANCE_M = 20;

/**
 * The stored view's pose when it still shows this anchor (not stale) — `goToPose` accepts C-C0's
 * `CloudViewPose` as is (T8-3) — else 20 m from the point (T8-4: a point, not a `CloudPin`, so
 * Task 9's arrival can call it without a finding).
 */
export function flyToPin(viewer: CloudViewerHandle, p: Vec3, view: CloudViewOut | undefined): void {
  if (view && !view.stale) viewer.goToPose(view.pose);
  else viewer.lookAt({ x: p[0], y: p[1], z: p[2] }, FLY_TO_DISTANCE_M);
}
