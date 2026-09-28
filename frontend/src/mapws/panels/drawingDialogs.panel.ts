import { DrawingDialogs } from "../drawings/DrawingDialogs";
import type { WorkspacePanel } from "./panelRegistry";

/** PF8: the drawing row menu's actions live on the stage, so collapsing the Layers panel keeps them. */
const panel: WorkspacePanel = {
  id: "drawing-dialogs",
  slot: "stage",
  order: 91,
  Component: DrawingDialogs,
};
export default panel;
