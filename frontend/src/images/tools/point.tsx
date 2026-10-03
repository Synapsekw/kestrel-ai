import type { ToolDefinition } from "./types";

/** M: a finding marker (spec I-D7). Defect types only (ruling FC-R6). */
export const POINT_TOOL: ToolDefinition = {
  id: "point",
  order: 60,
  action: "finding-marker",
  icon: "pin",
  label: "Point marker",
  hint: "Click to mark a defect",
  statusHints: "Click mark · T defect type",
  cursor: "crosshair",
  drawsShapes: true,
  typeFilter: (t) => t.kind === "defect",
  onDown: (p, api) => {
    if (p.button !== 0) return;
    const body = {
      shape: "point" as const,
      x: Math.round(p.image.x * 10) / 10,
      y: Math.round(p.image.y * 10) / 10,
    };
    const s = api.store.getState();
    const type = s.types.find((t) => t.id === s.activeTypeId);
    if (!type || type.kind !== "defect") {
      api.holdShape(body);
      if (type) api.notify("Point markers need a defect. Pick one, or name a new anomaly.");
      return;
    }
    void api.createShape(body);
  },
};
