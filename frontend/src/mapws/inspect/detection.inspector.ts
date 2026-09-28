import { detectionHint } from "../detect/detectionHint";
import { DetectionInspector } from "../detect/DetectionInspector";
import type { InspectorKind } from "../w4host";

/** `detection:<runId>.<detectionId>`: its own pane (R-W1-11); the hint pill names the review keys. */
const detectionInspector: InspectorKind = {
  id: "detection",
  label: "Detection",
  framed: false,
  Body: DetectionInspector,
  hint: detectionHint,
};

export default detectionInspector;
