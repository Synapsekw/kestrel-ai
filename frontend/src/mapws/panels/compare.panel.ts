import { CompareBar } from "../compare/CompareBar";
import type { WorkspacePanel } from "./panelRegistry";

const panel: WorkspacePanel = {
  id: "compare",
  slot: "top-center",
  order: 0,
  Component: CompareBar,
};
export default panel;
