/**
 * The one list of I-FC names FA's product code imports (I-FC plan, "Interfaces provided"). A rename
 * in FC is a change to this file alone.
 */
import { useImagesWorkspace, type ImagesWorkspaceState } from "@/store/imagesWorkspace";

export {
  useImagesWorkspace,
  pendingSuggestions,
  typeOf,
  THRESHOLD_STEP,
  type ImagesWorkspaceState,
} from "@/store/imagesWorkspace";
export { cmdReview, useCommandContext, type CommandContext } from "@/images/canvas/commands";
export { History } from "@/images/canvas/history";
export { ShapeNode } from "@/images/canvas/ShapeLayer";
export { bucketOf } from "@/images/canvas/lod";
export { useCanvasKeyHandlers } from "@/images/canvas/useCanvasKeys";
export { activateTool, getTool, registerTool } from "@/images/tools/registry";
export { useToolApi } from "@/images/tools/toolApi";
export type { ToolApi, ToolDefinition, ToolPointer } from "@/images/tools/types";
export {
  FA_ACTIONS,
  IMAGES_KEY_ROWS,
  registerKeyRows,
  row,
  useImagesKeymap,
  type ImagesKeyRow,
  type KeyHandlers,
} from "@/images/workspace/keymap";

/** FC's tool id for S (FC's `data-tool` hook names it `smart`); its F keymap action is `smart-polygon`. */
export const SMART_TOOL = "smart";

export type WsState = ImagesWorkspaceState;
/** Subscribe to one derived value; the selector must return a primitive or a stable reference (zustand 5). */
export const useWs = useImagesWorkspace;
/** The store read at call time (never a closed-over value, as FC's handlers do). */
export const wsGet = (): WsState => useImagesWorkspace.getState();
