import { RasterDialogs } from "../layers/RasterDialogs";
import type { WorkspacePanel } from "./panelRegistry";

const panel: WorkspacePanel = {
  id: "raster-dialogs",
  slot: "stage",
  order: 90,
  Component: RasterDialogs,
};
export default panel;
