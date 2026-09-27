import { CompareStage } from "../compare/CompareStage";
import type { WorkspacePanel } from "./panelRegistry";

const panel: WorkspacePanel = {
  id: "compare-stage",
  slot: "stage",
  order: 0,
  Component: CompareStage,
};
export default panel;
