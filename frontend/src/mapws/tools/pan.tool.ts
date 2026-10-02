import type { MapTool } from "./toolStore";

const pan: MapTool = {
  id: "pan",
  group: "navigate",
  topic: "nav",
  order: 1,
  icon: "hand",
  label: "Pan",
  action: "tool-pan",
  hint: "Drag to move the map · hold Space to pan from any tool",
  draw: { shape: "none" },
};

export default pan;
