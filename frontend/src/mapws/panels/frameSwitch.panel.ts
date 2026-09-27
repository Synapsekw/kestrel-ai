import { FrameSwitch } from "../frame/FrameSwitch";
import type { WorkspacePanel } from "./panelRegistry";

const panel: WorkspacePanel = {
  id: "frame-switch",
  slot: "coords-extra",
  order: 10,
  Component: FrameSwitch,
};
export default panel;
