import { NO_FEATURE } from "../compose";
import type { FeatureContext, WorkspaceFeature } from "../types";

/**
 * C-R1 replaces this body (plan Ruling 1): "Saving views n / N" in the hint bar and the Findings
 * tab's "Capture missing views" menu item. The capture queue itself is wired at the seams anchor in
 * CloudWorkspace.tsx.
 */
export function useReportViewsFeature(ctx: FeatureContext): WorkspaceFeature {
  void ctx;
  return NO_FEATURE("reportViews");
}
