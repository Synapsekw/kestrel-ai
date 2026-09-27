import type { MapTool } from "./toolStore";

const select: MapTool = {
  id: "select",
  group: "navigate",
  order: 0,
  icon: "cursor",
  label: "Select",
  action: "tool-select",
  hint: "Click a feature to inspect it · Del deletes it · Esc deselects",
  draw: { shape: "none" },
};

export default select;
