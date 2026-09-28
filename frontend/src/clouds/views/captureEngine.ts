import type { CloudViewPose } from "@contract/client";
import type { CloudViewerHandle } from "../CloudViewer";
import { CAPTURE_TIMEOUT_MS, type CaptureMark, type CaptureResult } from "../viewer/capture";
import { captureFovDeg } from "../viewer/lookThrough";
import { copyPose } from "./framing";

/** The only surface of the viewer the report-view client uses (Ruling 1). */
export interface CaptureEngine {
  /** The on-screen camera with its fov cropped to the capture's aspect 1.6, or null before the canvas exists. */
  currentPose(): CloudViewPose | null;
  capture(pose: CloudViewPose, marks: readonly CaptureMark[]): Promise<CaptureResult>;
}

export function captureEngineFrom(handle: CloudViewerHandle): CaptureEngine {
  return {
    currentPose: () => {
      const p = handle.currentPose();
      if (!p) return null;
      const pose = copyPose(p);
      const r = handle.canvasRect();
      const w = r ? r.right - r.left : 0;
      const h = r ? r.bottom - r.top : 0;
      // V1's pose carries the camera's own fov; the report view is 1.6 (Ruling 2)
      if (w > 0 && h > 0) pose.fov_deg = captureFovDeg(w / h, pose.fov_deg);
      return pose;
    },
    capture: (pose, marks) => handle.capture(pose, marks, { timeoutMs: CAPTURE_TIMEOUT_MS }),
  };
}
