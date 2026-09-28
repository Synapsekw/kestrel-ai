import type { ApiClient } from "@contract/client";
import { deleteDrawing, patchDrawing, type Drawing } from "@/api/drawings";
import { messageOf } from "@/api/errors";
import { openAddData } from "@/data/addDataTiles";
import { toast } from "@/ui";
import { bumpWorkspaceData } from "../data/bump";
import { useAlignStore } from "../georef/alignStore";
import { useGoneLayers } from "../layers/goneLayers";
import { useDrawingsStore } from "./drawingsStore";
import { setImportPrefill } from "./importPrefill";

/** The body of both delete confirmations (row menu and Del); W1's host supplies the title. */
export const DELETE_CONFIRM = "The drawing leaves the project; the original file is not touched.";

export async function toggleKnockout(api: ApiClient, projectId: string, d: Drawing): Promise<void> {
  try {
    const next = await patchDrawing(api, projectId, d.id, {
      layer_state: { ...d.layer_state, knockout_white: !d.layer_state.knockout_white },
    });
    useDrawingsStore.getState().upsert(next);
  } catch (e) {
    toast("danger", messageOf(e, "could not change the drawing"));
  }
}

/** R-W5-11: a new import of the same file; the old drawing stays until deleted. */
export function reimportDrawing(d: Drawing): void {
  setImportPrefill(d.source_path);
  openAddData("drawing");
}

/**
 * PF15: the drawings list and W1's layers read `mapWorkspaceRevision`; the row is marked gone
 * silently, so its late tile 404s do not report a drawing the operator just deleted as lost.
 */
export async function removeDrawing(api: ApiClient, projectId: string, id: string): Promise<void> {
  const name = useDrawingsStore.getState().byId[id]?.name ?? "The drawing";
  await deleteDrawing(api, projectId, id);
  useAlignStore.getState().endFor(id);
  useDrawingsStore.getState().remove(id);
  useGoneLayers.getState().markGone(`drawing:${id}`, name, { silent: true });
  bumpWorkspaceData();
}
