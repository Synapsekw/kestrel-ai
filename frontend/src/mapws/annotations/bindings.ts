import { useChangesStore } from "@/store/changes";
import { useWorkspaceLayers } from "@/mapws/data/useWorkspaceLayers";
import type { Geometry } from "@/mapws/tools/toolStore";
import type { WorkspaceLayer } from "@/mapws/types";

/*
 * The only W3 module that names M-W1's or M-W2's modules (as W1's R-W1-3 isolates M-C0): if a merged
 * name changes, only this file changes. Everything in measure/, findings/ and zones/ imports from
 * here, never from mapws/context, mapws/data, mapws/layers, mapws/tools, mapws/inspect, mapws/view,
 * mapws/timeline or mapws/readout directly.
 */
export { WorkspaceProvider, useTools, useWorkspace, useWorkspaceStores } from "@/mapws/context";
export { SELECTION_PROP, layerRegistry } from "@/mapws/layers/layerRegistry";
export type {
  LayerKind,
  LayerMountProps,
  LayerRow,
  LayerRowExtraProps,
  LayerRowsContext,
} from "@/mapws/layers/layerRegistry";
export { shortcutFor, toolRegistry } from "@/mapws/tools/toolStore";
export type { Completed, Geometry, MapTool, ToolContext, ToolOverlayProps } from "@/mapws/tools/toolStore";
export { inspectorRegistry, slotRegistry } from "@/mapws/inspect/inspectorRegistry";
export type { InspectorBodyProps, InspectorKind, InspectorSlot } from "@/mapws/inspect/inspectorRegistry";
export type {
  CompareMode,
  Coord,
  MapSide,
  Selection,
  SiteFrame,
  Survey,
  WorkspaceLayer,
} from "@/mapws/types";
export { toWgs84 } from "@/mapws/view/siteFrame";
export { useMapPane } from "@/mapws/view/SiteMap";
/** M-W3 preflight P5: W2's fields read off the raw `WorkspaceLayer` row. */
export { elevationRoleOf, elevationRows, baseMapRows, surfaceKindOf } from "@/mapws/layers/rasterRows";
/** M-W3 preflight P5: W1's panel order for the picking rules (Task 3). */
export { orderRows } from "@/mapws/layers/placement";
/** M-W3 preflight P5/P4/A21: W1's date formatter and the session's dropped-layer keys. */
export { formatSurveyDate } from "@/mapws/timeline/timelineModel";
export { useGoneLayers } from "@/mapws/layers/goneLayers";
/** M-W3 preflight P5/A8: W1's `sampleInFrame` — W3 adds no duplicate in `api/mapFindings.ts`. */
export { sampleInFrame } from "@/mapws/readout/sampleApi";

/**
 * The workspace layers W1 has loaded (`useWorkspaceLayers`, controller reconciliation 1), for every
 * W3 overlay, Mount and inspector. W3 reads no layer list of its own.
 */
export function useSiteLayers(): WorkspaceLayer[] {
  return useWorkspaceLayers().layers;
}

/** W2's row key for a server layer (`<kind>:<id>`); a row with no layer state is visible. */
export function isShown(
  layer: { kind: string; id: string },
  layerState: Readonly<Record<string, { visible: boolean } | undefined>>,
): boolean {
  return layerState[`${layer.kind}:${layer.id}`]?.visible ?? true;
}

/** W3-18: a create re-reads the Measurements layer at once. */
export function bumpMapMeasurements(): void {
  useChangesStore.setState((s) => ({
    mapMeasurementsRevision: s.mapMeasurementsRevision + 1,
  }));
}

/** W1's finished geometry as plain vertices; a Polygon ring comes back open. */
export function completedCoords(g: Geometry): number[][] {
  switch (g.type) {
    case "Point":
      return [[g.coordinates[0], g.coordinates[1]]];
    case "LineString":
      return g.coordinates.map((c) => [c[0], c[1]]);
    case "Polygon":
      return g.coordinates[0].slice(0, -1).map((c) => [c[0], c[1]]);
    default:
      return [];
  }
}
