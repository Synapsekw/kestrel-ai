import type { ToolDefinition } from "./types";

/** V. Shape clicks, drags, the Transformer and vertex handles live in the canvas layers (Task 7). */
export const SELECT_TOOL: ToolDefinition = {
  id: "select",
  order: 10,
  action: "tool-select",
  icon: "fit",
  label: "Select",
  hint: "Click, Shift+click to add",
  statusHints: "Click select · Shift+click add · Drag move · Alt+click edge add vertex · Alt+click vertex remove",
  cursor: "default",
  drawsShapes: false,
  onDown: (p, api) => {
    const s = api.store.getState();
    if (p.button !== 0 || p.shift) return;
    s.select([]);
    s.selectMeasurement(null);
  },
};
