import { CamerasPanelRow } from "@/clouds/cameras/CamerasPanelRow";
import { CloudCameras } from "@/clouds/cameras/CloudCameras";
import { useCloudCameras } from "@/clouds/cameras/useCloudCameras";
import type { FeatureContext, WorkspaceFeature, WorkspaceTool } from "../types";

/**
 * Tool I (Photo link). It needs no `onPick`: the cameras layer reads the canvas clicks itself, so
 * glyphs above the cloud can be clicked too (C-L1 Rulings 6 and 13).
 */
const PHOTO_TOOL: WorkspaceTool = { id: "photo", picks: false };

/**
 * C-L1 (spec §10.2–10.4): the photo-link tool, the camera glyphs with their popover and the
 * `?from_image=` arrival (`layer`), and section (7) of the cloud panel (`cloudPanel`).
 *
 * `useCloudCameras` runs here rather than in the `layer` (controller Ruling 3): this feature is
 * always mounted with the ready workspace, but `layer` renders only while the view is running, so a
 * fetch in the layer would leave the cloud panel's row stuck on "Loading…" on a machine with no
 * WebGL or a lost context.
 */
export function useCamerasFeature(ctx: FeatureContext): WorkspaceFeature {
  useCloudCameras(ctx.projectId, ctx.cloud);
  return {
    name: "cameras",
    tools: [PHOTO_TOOL],
    layer: (
      <CloudCameras
        projectId={ctx.projectId}
        cloud={ctx.cloud}
        viewer={ctx.viewer}
        tool={ctx.activeTool}
        search={ctx.search}
      />
    ),
    cloudPanel: <CamerasPanelRow projectId={ctx.projectId} cloud={ctx.cloud} />,
  };
}
