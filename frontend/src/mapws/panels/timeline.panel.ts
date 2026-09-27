import { TimelineScrubber } from "../timeline/TimelineScrubber";
import type { WorkspacePanel } from "./panelRegistry";

const panel: WorkspacePanel = {
  id: "timeline",
  slot: "bottom-center",
  order: 0,
  Component: TimelineScrubber,
};
export default panel;
