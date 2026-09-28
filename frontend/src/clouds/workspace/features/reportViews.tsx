import { SavingViewsHint, useCaptureMissingItem } from "@/clouds/views/SavingViewsHint";
import { useViewStore } from "@/clouds/views/viewStore";
import type { FeatureContext, WorkspaceFeature } from "../types";

/**
 * C-R1 (W1 plan Ruling 1): the Findings tab's "Capture missing views" item and "Saving views n / N"
 * in the hint bar. The capture queue itself is wired at the seams anchor in CloudWorkspace.tsx.
 * `hintProgress` is undefined while no bulk run is going: any node there keeps the hint bar from fading.
 */
export function useReportViewsFeature(ctx: FeatureContext): WorkspaceFeature {
  void ctx;
  const item = useCaptureMissingItem();
  const running = useViewStore((s) => s.bulk !== null);
  return {
    name: "reportViews",
    findingsMenu: [item],
    hintProgress: running ? <SavingViewsHint /> : undefined,
  };
}
