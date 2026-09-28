import { RunInspector } from "../detect/RunInspector";
import type { InspectorKind } from "../w4host";

/** `run:<runId>`: its own pane (R-W1-11). */
const runInspector: InspectorKind = {
  id: "run",
  label: "Detection run",
  framed: false,
  Body: RunInspector,
};

export default runInspector;
