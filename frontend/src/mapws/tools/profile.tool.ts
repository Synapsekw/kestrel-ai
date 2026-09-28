import { useGoneLayers, type MapTool } from "@/mapws/annotations/bindings";
import { hasElevation } from "@/mapws/annotations/pick";
import { PROFILE_NEEDS_ELEVATION } from "@/mapws/measure/actions";
import { ProfileOverlay } from "@/mapws/measure/MeasureOverlay";

/** Spec §5.1 `E`: a two-click (or multi-vertex) line → the profile chart (§9.2). */
const profile: MapTool = {
  id: "profile",
  group: "measure",
  order: 30,
  icon: "profile",
  label: "Elevation profile",
  action: "profile",
  hint: "Click the start and the end · more clicks bend the line · double-click finishes",
  draw: { shape: "line", min: 2 },
  // W1's ToolContext has no gone keys: read them here (M-W3 P4).
  disabledReason: (ctx) =>
    hasElevation(ctx.layers, useGoneLayers.getState().gone) ? null : PROFILE_NEEDS_ELEVATION,
  Overlay: ProfileOverlay,
};

export default profile;
