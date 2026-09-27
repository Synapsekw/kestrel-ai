import { useEffect, useMemo } from "react";
import { MeasurePanel } from "@/clouds/MeasurePanel";
import { overlayShapes, type MeasureKind } from "@/clouds/measure";
import { useMeasureTool } from "@/clouds/useMeasureTool";
import type { CloudToolId } from "../tools";
import type { FeatureContext, WorkspaceFeature, WorkspaceTool } from "../types";

const KINDS: readonly MeasureKind[] = ["point", "distance", "height", "vertical"];
const TOOL: Record<string, CloudToolId> = {
  point: "point",
  distance: "distance",
  height: "height",
  vertical: "vertical",
};

/**
 * C-M1 replaces this body (plan Ruling 1): the measure tools, the Measurements tab, the 3D labels,
 * the profile panel and the profile line on the minimap.
 *
 * Until then (plan Ruling 8) S1's four tools are on the palette and S1's MeasurePanel is the
 * Measurements tab, so nothing S1 could do is lost.
 */
export function useMeasureFeature(ctx: FeatureContext): WorkspaceFeature {
  const measure = useMeasureTool();
  const { viewer, arm, showTab, projectId, cloud } = ctx;
  const { tool: kind, picks, hover } = measure;

  useEffect(() => {
    viewer.current?.setOverlay("measure", kind ? overlayShapes(kind, picks, hover) : []);
  }, [viewer, kind, picks, hover]);

  const tools = useMemo<WorkspaceTool[]>(
    () =>
      KINDS.map((k) => ({
        id: TOOL[k],
        picks: true,
        onArm: () => {
          measure.arm(k);
          showTab("measurements");
        },
        onDisarm: measure.cancel,
        onPick: measure.add,
        onHover: measure.setHover,
        onCancel: () => {
          if (measure.picks.length === 0) return false;
          measure.arm(k);
          return true;
        },
      })),
    [measure, showTab],
  );

  // MeasurePanel's own arming buttons go through the palette, so the two never disagree.
  const panelTool = useMemo(
    () => ({ ...measure, arm: (k: MeasureKind) => arm(TOOL[k]), cancel: () => arm("orbit") }),
    [measure, arm],
  );

  return {
    name: "measure",
    tools,
    measurementsTab: {
      body: (
        <MeasurePanel
          key={cloud.id}
          projectId={projectId}
          cloud={cloud}
          tool={panelTool}
          onFlyTo={(p) => viewer.current?.lookAt({ x: p.x, y: p.y, z: p.z }, 30)}
        />
      ),
    },
  };
}
