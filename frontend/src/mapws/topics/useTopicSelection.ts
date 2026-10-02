import { useWorkspace, useWorkspaceStores } from "../context";
import type { Coord } from "../types";
import { extentOf } from "./listItems";

/**
 * Spec §2 "List": a row click selects the item and frames it on the stage. Item ids are
 * `<selection kind>:<id>`; `coordsOf` gives the item's site coordinates (none: select only).
 */
export function useTopicSelection(coordsOf: (itemId: string) => readonly (readonly number[])[] | undefined) {
  const { workspace } = useWorkspaceStores();
  const selectedId = useWorkspace((s) => (s.selection ? `${s.selection.kind}:${s.selection.id}` : null));
  const onSelect = (itemId: string) => {
    const at = itemId.indexOf(":");
    const { select, viewApi } = workspace.getState();
    select({ kind: itemId.slice(0, at), id: itemId.slice(at + 1) });
    const ext = extentOf(coordsOf(itemId) ?? []);
    if (!ext || !viewApi) return;
    if (ext[0] === ext[2] && ext[1] === ext[3]) viewApi.centreOn([ext[0], ext[1]] as Coord);
    else viewApi.fit(ext);
  };
  return { selectedId, onSelect };
}
