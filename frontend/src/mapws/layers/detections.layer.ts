import { DetectionFilters } from "../detect/DetectionFilters";
import { DetectionMount } from "../detect/DetectionMount";
import type { LayerKind } from "../w4host";

/** The one undated AI detections row (default visible, ruling T15-3); its filters live in the W4 store (R-W4-5). */
const detectionsLayer: LayerKind = {
  id: "detections",
  group: "annotations",
  icon: "detect",
  rows: () => [
    {
      key: "detections:detections",
      kind: "detections",
      group: "annotations",
      id: "detections",
      name: "AI detections",
      meta: "Selected surveys",
      date: null,
    },
  ],
  Mount: DetectionMount,
  RowExtra: DetectionFilters,
};

export default detectionsLayer;
