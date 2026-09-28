import type { MapTool } from "@/mapws/annotations/bindings";
import { findingToolUnavailable } from "@/mapws/findings/actions";
import { FindingPointOverlay } from "@/mapws/findings/FindingOverlay";

/** Spec §5.1 `M`: one click → the type picker → a finding with a map anchor. */
const findingPoint: MapTool = {
  id: "finding-point",
  group: "annotate",
  order: 10,
  icon: "pin",
  label: "Add finding point",
  action: "finding-marker",
  hint: "Click where the defect is · then pick its type",
  draw: { shape: "point" },
  disabledReason: findingToolUnavailable,
  Overlay: FindingPointOverlay,
};

export default findingPoint;
