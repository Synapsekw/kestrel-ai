import { BOX_TOOL } from "./box";
import { LENGTH_TOOL } from "./length";
import { PAN_TOOL } from "./pan";
import { POINT_TOOL } from "./point";
import { POLYGON_TOOL } from "./polygon";
import { RBOX_TOOL } from "./rbox";
import { listTools, registerTool } from "./registry";
import { SELECT_TOOL } from "./select";

export const BUILT_IN_TOOLS = [SELECT_TOOL, PAN_TOOL, BOX_TOOL, RBOX_TOOL, POLYGON_TOOL, POINT_TOOL, LENGTH_TOOL];

/** Registers FC's tools once (idempotent; FA registers S separately, order 55). */
export function ensureBuiltInTools(): void {
  const have = new Set(listTools().map((t) => t.id));
  for (const t of BUILT_IN_TOOLS) if (!have.has(t.id)) registerTool(t);
}
