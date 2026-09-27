import { ReadoutZ } from "../readout/ReadoutZ";
import type { WorkspacePanel } from "./panelRegistry";

const panel: WorkspacePanel = {
  id: "readout-z",
  slot: "coords-extra",
  order: 0,
  Component: ReadoutZ,
};
export default panel;
