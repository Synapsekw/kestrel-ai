import { useGoneLayers, type MapTool } from "@/mapws/annotations/bindings";
import { findingToolUnavailable } from "@/mapws/findings/actions";
import { FindingPolygonOverlay } from "@/mapws/findings/FindingOverlay";

/** Spec §5.1 `G`: a polygon → the type picker → a finding with a map anchor. */
const findingPolygon: MapTool = {
  id: "finding-polygon",
  topic: "findings",
  order: 20,
  icon: "polygon",
  label: "Add finding polygon",
  action: "finding-polygon",
  hint: "Click around the defect · double-click to close · then pick its type",
  draw: { shape: "polygon", min: 3 },
  // W1's ToolContext has no gone keys: read them here (M-W3 P4).
  disabledReason: (ctx) => findingToolUnavailable({ ...ctx, gone: useGoneLayers.getState().gone }),
  Overlay: FindingPolygonOverlay,
};

export default findingPolygon;
