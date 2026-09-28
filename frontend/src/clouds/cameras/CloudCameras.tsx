import type { RefObject } from "react";
import type { PointCloud } from "@/api/clouds";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import type { CloudToolId } from "@/clouds/workspace/tools";
import { CameraGlyphs } from "./CameraGlyphs";
import { useCamerasDiagnostics } from "./diagnostics";
import { PhotoLinkTool } from "./PhotoLinkTool";
import { useFromImageArrival } from "./useFromImageArrival";

export interface CloudCamerasProps {
  projectId: string;
  /** A ready cloud (W1 renders the viewer layers only for one). */
  cloud: PointCloud;
  viewer: RefObject<CloudViewerHandle | null>;
  /** The armed tool, C-W1's `CloudToolId` ("orbit", "pan", "photo", …). */
  tool: CloudToolId;
  /** The route's `location.search`, for the `?from_image=` arrival. */
  search: string;
}

/**
 * C-L1's layer in the viewport (spec §10.2–10.4): draws the glyphs and their popover, runs the
 * photo-link tool and the image → cloud arrival. Pointer-transparent; its popovers are portalled.
 *
 * Controller Ruling 3: `useCloudCameras` itself runs in `useCamerasFeature`, not here — this layer
 * mounts only while the view is running, so a loader in here would leave the always-mounted cloud
 * panel row stuck on "Loading…" when WebGL is missing or lost.
 */
export function CloudCameras({ projectId, cloud, viewer, tool, search }: CloudCamerasProps) {
  useFromImageArrival(viewer, cloud, search);
  useCamerasDiagnostics(viewer, cloud.bounds_native?.[5] ?? 0);
  return (
    <>
      <CameraGlyphs projectId={projectId} cloud={cloud} viewer={viewer} tool={tool} />
      <PhotoLinkTool projectId={projectId} cloud={cloud} viewer={viewer} active={tool === "photo"} />
    </>
  );
}
