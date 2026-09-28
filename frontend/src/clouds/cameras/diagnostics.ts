import { useEffect, type RefObject } from "react";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { diagnosticsEnabled } from "@/clouds/viewer/diagnostics";
import { cameraZ } from "./cameraMath";
import { useCamerasStore } from "./store";

/** For the e2e tests (only with `kestrel.diagnostics` = "1"): where the glyphs are, and the look-through state. */
export interface CamerasDiagnostics {
  /** Cameras whose centre projects onto the canvas, in client pixels. */
  glyphs(): { imageId: string; x: number; y: number }[];
  lookingThrough(): boolean;
}

declare global {
  interface Window {
    __kestrelCloudCameras?: CamerasDiagnostics;
  }
}

export function useCamerasDiagnostics(
  viewer: RefObject<CloudViewerHandle | null>,
  fallbackTop: number,
): void {
  useEffect(() => {
    if (!diagnosticsEnabled()) return;
    const hook: CamerasDiagnostics = {
      glyphs() {
        const v = viewer.current;
        const rect = v?.canvasRect();
        const { set } = useCamerasStore.getState();
        if (!v || !rect || !set) return [];
        return set.image_id.flatMap((imageId, i) => {
          const p = v.project({ x: set.x[i], y: set.y[i], z: cameraZ(set, i, fallbackTop) });
          const on = p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
          return on ? [{ imageId, x: p.x, y: p.y }] : [];
        });
      },
      lookingThrough: () => useCamerasStore.getState().lookingThrough,
    };
    window.__kestrelCloudCameras = hook;
    return () => {
      if (window.__kestrelCloudCameras === hook) delete window.__kestrelCloudCameras;
    };
  }, [viewer, fallbackTop]);
}
