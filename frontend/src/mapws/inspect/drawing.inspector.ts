import type { InspectorKind } from "./inspectorRegistry";
import { DrawingInspector } from "../drawings/DrawingInspector";
import { DELETE_CONFIRM, removeDrawing } from "../drawings/drawingActions";

/** W5's inspector plugin (spec §5.3 "Drawing"); W1's host titles, confirms and runs `remove` on Del. */
const drawingInspector: InspectorKind = {
  id: "drawing",
  label: "Drawing",
  framed: true,
  Body: DrawingInspector,
  remove: {
    confirm: () => DELETE_CONFIRM,
    run: (sel, { api, projectId }) => removeDrawing(api, projectId, sel.id),
  },
};

export default drawingInspector;
