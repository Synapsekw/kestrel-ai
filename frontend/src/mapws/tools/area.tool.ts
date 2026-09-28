import type { MapTool } from "@/mapws/annotations/bindings";
import { AreaOverlay } from "@/mapws/measure/MeasureOverlay";

/** Spec §5.1 `Q`: a polygon, stored as a `map_measurement` area. */
const area: MapTool = {
  id: "area",
  group: "measure",
  order: 20,
  icon: "area",
  label: "Measure area",
  action: "area",
  hint: "Click to add vertices · double-click to close · Esc cancels",
  draw: { shape: "polygon", min: 3 },
  Overlay: AreaOverlay,
};

export default area;
