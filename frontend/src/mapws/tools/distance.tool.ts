import type { MapTool } from "@/mapws/annotations/bindings";
import { DistanceOverlay } from "@/mapws/measure/MeasureOverlay";

/** Spec §5.1 `L`: a line, stored as a `map_measurement` distance (§9.1). */
const distance: MapTool = {
  id: "distance",
  topic: "measure",
  order: 10,
  icon: "measure",
  label: "Measure distance",
  action: "measure-length",
  hint: "Click to add vertices · double-click or Enter finishes · Backspace removes the last",
  draw: { shape: "line", min: 2 },
  Overlay: DistanceOverlay,
};

export default distance;
