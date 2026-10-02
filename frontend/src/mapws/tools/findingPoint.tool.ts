import { useGoneLayers, type MapTool } from "@/mapws/annotations/bindings";
import { findingToolUnavailable } from "@/mapws/findings/actions";
import { FindingPointOverlay } from "@/mapws/findings/FindingOverlay";

/** Spec §5.1 `M`: one click → the type picker → a finding with a map anchor. */
const findingPoint: MapTool = {
  id: "finding-point",
  group: "annotate",
  topic: "findings",
  order: 10,
  icon: "pin",
  label: "Add finding point",
  action: "finding-marker",
  hint: "Click where the defect is · then pick its type",
  draw: { shape: "point" },
  // W1's ToolContext has no gone keys: read them here (M-W3 P4).
  disabledReason: (ctx) => findingToolUnavailable({ ...ctx, gone: useGoneLayers.getState().gone }),
  Overlay: FindingPointOverlay,
};

export default findingPoint;
