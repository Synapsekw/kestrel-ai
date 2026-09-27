import type { ToolDefinition } from "./types";

/** H. The canvas pans on any left drag while this tool is active (as with Space held). */
export const PAN_TOOL: ToolDefinition = {
  id: "pan",
  order: 20,
  action: "tool-pan",
  icon: "map",
  label: "Pan",
  hint: "Drag to move around; Space pans from any tool",
  statusHints: "Drag pan · Wheel zoom · Middle button pans in every tool",
  cursor: "grab",
  drawsShapes: true,
};
