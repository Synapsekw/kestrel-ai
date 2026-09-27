import { NO_FEATURE } from "../compose";
import type { FeatureContext, WorkspaceFeature } from "../types";

/**
 * C-L1 replaces this body (plan Ruling 1): the photo-link tool, the camera switch in the cloud
 * panel, the camera glyphs and their popover.
 */
export function useCamerasFeature(ctx: FeatureContext): WorkspaceFeature {
  void ctx;
  return NO_FEATURE("cameras");
}
