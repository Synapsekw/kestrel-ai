import { Minimap } from "../minimap/Minimap";
import type { WorkspacePanel } from "./panelRegistry";

const panel: WorkspacePanel = {
  id: "minimap",
  slot: "bottom-right",
  order: 0,
  Component: Minimap,
};
export default panel;
