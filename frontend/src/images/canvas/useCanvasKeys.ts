import { useMemo } from "react";
import { activateTool, getTool } from "@/images/tools/registry";
import { clearHeldShape, useToolApi } from "@/images/tools/toolApi";
import type { KeyHandlers } from "@/images/workspace/keymap";
import { useImagesWorkspace, type ToolId } from "@/store/imagesWorkspace";
import { deleteSelection, duplicateSelection, nudgeSelection, rotateSelection } from "./actions";
import { cmdRedo, cmdUndo, type CommandContext } from "./commands";
import { ZOOM_STEP } from "./geometry";

const NUDGE: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

/** FC's key handlers (spec §13); FW passes them as the first layer to useImagesKeymap. */
export function useCanvasKeyHandlers(ctx: CommandContext): KeyHandlers {
  const api = useToolApi(ctx);
  return useMemo<KeyHandlers>(() => {
    const st = () => useImagesWorkspace.getState();
    const current = () => getTool(st().tool);
    const tool = (id: ToolId) => () => activateTool(id, api);
    return {
      "tool-select": tool("select"),
      "tool-pan": tool("pan"),
      box: tool("box"),
      "rotated-box": tool("rbox"),
      polygon: tool("polygon"),
      "finding-marker": tool("point"),
      "measure-length": tool("length"),
      cancel: () => {
        const s = st();
        // Dialog and Popover handle Esc themselves (and stop it) while focus is inside them; this
        // covers focus left outside, closing just the open layer and nothing behind it.
        if (s.confirm) return void s.setConfirm(null);
        if (s.picker) {
          clearHeldShape();
          s.closePicker();
          return;
        }
        if (s.draft) {
          if (!current()?.onCancel?.(api)) s.setDraft(null);
          return;
        }
        if (s.selectedIds.length || s.selectedMeasurementId) {
          s.select([]);
          s.selectMeasurement(null);
          return;
        }
        return false; // FW clears the arrival marker next
      },
      commit: () => current()?.onCommit?.(api) ?? false,
      "remove-vertex": () => current()?.onRemoveVertex?.(api) ?? false,
      delete: () => void deleteSelection(ctx),
      undo: () => {
        const s = st();
        if (s.draft) {
          if (!current()?.onRemoveVertex?.(api)) s.setDraft(null);
          return;
        }
        // Queued behind any save in flight, so the compensating call targets settled state.
        void cmdUndo(ctx);
      },
      redo: () => void cmdRedo(ctx),
      fit: () => st().fit(),
      "zoom-in": () => st().zoomBy(ZOOM_STEP),
      "zoom-out": () => st().zoomBy(1 / ZOOM_STEP),
      "one-to-one": () => st().oneToOne(),
      duplicate: () => void duplicateSelection(ctx),
      rotate: (chord) => void rotateSelection(ctx, chord.endsWith("ArrowLeft") ? -1 : 1),
      nudge: (chord) => {
        const [dx, dy] = NUDGE[chord.split("+").pop() ?? ""] ?? [0, 0];
        const step = chord.includes("Shift+") ? 10 : 1;
        void nudgeSelection(ctx, dx * step, dy * step);
      },
      "annotations-toggle": () => st().toggleAnnotations(),
      "suggestions-toggle": () => st().toggleSuggestions(),
      "type-picker": () => api.openPicker(st().selectedIds.length ? "retype" : "active"),
    };
  }, [ctx, api]);
}
