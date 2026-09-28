import { useEffect } from "react";
import { useApi } from "@/api/client";
import { useTools, useWorkspace, useWorkspaceStores } from "@/mapws/context";
import { ConfirmDeleteDialog } from "../layers/ConfirmDeleteDialog";
import type { PanelProps } from "../panels/panelRegistry";
import { ALIGN_TOOL_ID } from "./AlignOverlay";
import { DELETE_CONFIRM, reimportDrawing, removeDrawing, toggleKnockout } from "./drawingActions";
import { useDrawingUi } from "./drawingUi";
import { useDrawingsStore } from "./drawingsStore";

/**
 * Performs what a drawing row menu asked for (R-W5-15) and hosts the delete confirmation. PF8: a
 * stage panel, like W2's `RasterDialogs`, because W1 unmounts a row's `RowExtra` when the Layers
 * panel collapses; the dialog portals to `body`, so the stage slot is fine.
 */
export function DrawingDialogs({ projectId }: PanelProps) {
  const api = useApi();
  const { workspace } = useWorkspaceStores();
  const select = useWorkspace((s) => s.select);
  const activate = useTools((s) => s.activate);
  const intent = useDrawingUi((s) => s.intent);
  const drawing = useDrawingsStore((s) => (intent ? (s.byId[intent.id] ?? null) : null));

  useEffect(() => {
    if (!intent || intent.kind === "delete") return;
    useDrawingUi.getState().clear();
    const d = useDrawingsStore.getState().byId[intent.id];
    if (intent.kind === "properties" || intent.kind === "align" || intent.kind === "layers")
      select({ kind: "drawing", id: intent.id });
    if (intent.kind === "align") activate(ALIGN_TOOL_ID);
    if (intent.kind === "knockout" && d) void toggleKnockout(api, projectId, d);
    if (intent.kind === "reimport" && d) reimportDrawing(d);
  }, [intent, select, activate, api, projectId]);

  if (intent?.kind !== "delete") return null;
  const close = () => useDrawingUi.getState().clear();
  const id = intent.id;
  return (
    <ConfirmDeleteDialog
      title={`Delete ${drawing?.name ?? "this drawing"}?`}
      body={DELETE_CONFIRM}
      onConfirm={async () => {
        await removeDrawing(api, projectId, id);
        // Its inspector would otherwise wait for a drawing that is gone.
        const sel = workspace.getState().selection;
        if (sel?.kind === "drawing" && sel.id === id) select(null);
      }}
      onClose={close}
    />
  );
}
