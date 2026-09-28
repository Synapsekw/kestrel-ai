import { RegionInspector } from "../detect/RegionInspector";
import type { InspectorKind } from "../w4host";

/** `region:draft`: the box the AI detect tool drew; its own pane (R-W1-11). */
const regionInspector: InspectorKind = {
  id: "region",
  label: "AI detect in a region",
  framed: false,
  Body: RegionInspector,
};

export default regionInspector;
