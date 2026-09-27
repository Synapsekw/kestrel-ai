import { NO_FEATURE } from "../compose";
import type { FeatureContext, WorkspaceFeature } from "../types";

/**
 * C-P1 replaces this body (plan Ruling 1): the pin tool, the pins layer, the callout, the Findings
 * tab and the finding dots on the minimap.
 */
export function usePinsFeature(ctx: FeatureContext): WorkspaceFeature {
  void ctx;
  return NO_FEATURE("pins");
}
