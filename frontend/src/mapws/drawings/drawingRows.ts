import type { LayerRow, LayerRowsContext } from "@/mapws/layers/layerRegistry";
import type { MenuItem } from "@/ui";
import { useDrawingUi, type DrawingIntent } from "./drawingUi";
import { useDrawingsStore } from "./drawingsStore";

/**
 * Spec §5.2 Drawings rows: one undated row per drawing ("not placed" comes in the server's meta
 * line). PF2: reads the contract `WorkspaceLayer` fields directly.
 */
export function drawingRows(ctx: LayerRowsContext): LayerRow[] {
  return ctx.layers
    .filter((l) => l.kind === "drawing")
    .map((l) => ({
      key: `drawing:${l.id}`,
      kind: "drawing",
      group: "drawings",
      id: l.id,
      name: l.name,
      meta: l.meta,
      date: null,
      badge: l.placed ? "GEO" : undefined,
      version: l.version,
      layer: l,
    }));
}

/** Spec §5.2 row menu; each item posts an intent that the drawing dialogs perform (R-W5-15). */
export function drawingRowMenu(row: LayerRow): MenuItem[] {
  const ask = (kind: DrawingIntent["kind"]) => () => useDrawingUi.getState().request({ kind, id: row.id });
  const knockedOut = useDrawingsStore.getState().byId[row.id]?.layer_state.knockout_white === true;
  const status = row.layer?.status;
  const alignHint =
    status === "ready" ? undefined : status === "failed" ? "The import failed" : "Still importing";
  return [
    // PF11: a raster drawing has no pickable map features, so the menu is the way to its inspector.
    { id: "properties", label: "Properties", icon: "info", onSelect: ask("properties") },
    {
      id: "align",
      label: "Align",
      icon: "align",
      shortcut: "K",
      disabled: status !== "ready",
      hint: alignHint,
      onSelect: ask("align"),
    },
    row.layer?.vector
      ? { id: "layers", label: "Layers…", icon: "layers", onSelect: ask("layers") }
      : {
          id: "knockout",
          label: knockedOut ? "Show white" : "Knock out white",
          icon: "eye",
          onSelect: ask("knockout"),
        },
    { id: "reimport", label: "Re-import…", icon: "refresh", onSelect: ask("reimport") },
    { id: "delete", label: "Delete…", icon: "trash", danger: true, onSelect: ask("delete") },
  ];
}
