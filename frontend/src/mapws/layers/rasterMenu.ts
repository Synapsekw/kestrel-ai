import { create } from "zustand";
import type { MenuItem } from "@/ui";
import type { LayerRow } from "./layerRegistry";
import { surfaceKindOf } from "./rasterRows";

export interface RasterAction {
  type: "date" | "run" | "evaluate" | "delete";
  row: LayerRow;
}

/** W1's `menu(row)` has no hooks or state; it asks `RasterDialogs` (Task 5) to act. */
export const useRasterActions = create<{
  current: RasterAction | null;
  request: (a: RasterAction) => void;
  clear: () => void;
}>((set) => ({
  current: null,
  request: (current) => set({ current }),
  clear: () => set({ current: null }),
}));

const ask = (type: RasterAction["type"], row: LayerRow) => () =>
  useRasterActions.getState().request({ type, row });

/** M §5.2 row menus (deviation 4: no Rename; W2-11: date and role on dem only). */
export function rasterMenu(row: LayerRow): MenuItem[] {
  if (row.kind === "map") {
    return [
      { id: "date", label: "Set survey date", onSelect: ask("date", row) },
      {
        id: "run",
        label: "Run AI on the whole map",
        icon: "detect",
        onSelect: ask("run", row),
      },
      {
        id: "evaluate",
        label: "Open in evaluation view",
        icon: "external",
        onSelect: ask("evaluate", row),
      },
      {
        id: "delete",
        label: "Delete map",
        icon: "trash",
        danger: true,
        onSelect: ask("delete", row),
      },
    ];
  }
  const items: MenuItem[] = [];
  if (row.layer && surfaceKindOf(row.layer) === "dem") {
    items.push({
      id: "date",
      label: "Set date and role",
      onSelect: ask("date", row),
    });
  }
  items.push({
    id: "delete",
    label: "Delete surface",
    icon: "trash",
    danger: true,
    onSelect: ask("delete", row),
  });
  return items;
}
