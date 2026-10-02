import type { LayerRow, LayerRowsContext } from "@/mapws/layers/layerRegistry";
import type { MenuItem } from "@/ui";
import { useDrawingUi, type DrawingIntent } from "./drawingUi";

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

/**
 * Spec §3.1 row menu: Properties, Re-import, Delete. Align, Knock out white and the DXF layer
 * toggles live only in the drawing inspector. Each item posts an intent the drawing dialogs perform.
 */
export function drawingRowMenu(row: LayerRow): MenuItem[] {
  const ask = (kind: DrawingIntent["kind"]) => () => useDrawingUi.getState().request({ kind, id: row.id });
  return [
    // PF11: a raster drawing has no pickable map features, so the menu is the way to its inspector.
    { id: "properties", label: "Properties", icon: "info", onSelect: ask("properties") },
    { id: "reimport", label: "Re-import…", icon: "refresh", onSelect: ask("reimport") },
    { id: "delete", label: "Delete…", icon: "trash", danger: true, onSelect: ask("delete") },
  ];
}
