import { useEffect } from "react";
import type { ApiClient } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listSurfaces } from "@/api/surfaces";
import { fetchVolume } from "@/api/volumes";
import { pushLog } from "@/app/diagnostics";
import {
  useTools,
  useWorkspace,
  useWorkspaceLayers,
  useWorkspaceStores,
  type SiteFrame,
  type ToolOverlayProps,
} from "@/mapws/w4host";
import { toast } from "@/ui";
import { createFromRing } from "./createFromRing";
import { saveVolume } from "./saveVolume";
import { openRing, withExclusion } from "./volumeFeatures";
import { sameFrame, volumeSelection } from "./volumeModel";
import { useVolumeStore } from "./volumeStore";

const OTHER_CRS = "Draw masks in the Measurements view: this surface is in another CRS than the map.";

/**
 * A mask drawn for the selected measurement (ruling T8-2). Mask rings are stored in the top surface's
 * CRS, so a site ring is written only when the site frame is that CRS; otherwise nothing is sent.
 */
async function saveMask(
  api: ApiClient,
  projectId: string,
  id: string,
  kind: "stable" | "exclusion",
  ring: number[][],
  frame: SiteFrame,
  autoRecalc: boolean,
): Promise<void> {
  try {
    const [m, surfaces] = await Promise.all([fetchVolume(api, projectId, id), listSurfaces(api, projectId)]);
    const top = surfaces.find((s) => s.id === m.top_surface_id);
    if (!top || !sameFrame(frame, top)) {
      toast("info", OTHER_CRS);
      return;
    }
    const patch =
      kind === "stable"
        ? { alignment: { stable_polygon: ring } }
        : withExclusion(m, ring, crypto.randomUUID());
    await saveVolume(api, projectId, id, patch, autoRecalc);
  } catch (err) {
    const message = messageOf(err, "could not save the mask");
    pushLog(`save the volume mask failed: ${message}`);
    toast("danger", message);
  }
}

/**
 * Mounted while the Volume tool is active: a finished polygon becomes a new measurement (opened in the
 * inspector), or — while the inspector draws a mask — the selected measurement's stable area or exclusion.
 */
export function VolumeDrawOverlay({ projectId, frame }: ToolOverlayProps) {
  const api = useApi();
  const { tools } = useWorkspaceStores();
  const completed = useTools((s) => s.completed);
  const clearCompleted = useTools((s) => s.clearCompleted);
  const activate = useTools((s) => s.activate);
  const r = useWorkspace((s) => s.r);
  const selection = useWorkspace((s) => s.selection);
  const select = useWorkspace((s) => s.select);
  const { layers } = useWorkspaceLayers();
  const drawing = useVolumeStore((s) => s.drawing);
  const setDrawing = useVolumeStore((s) => s.setDrawing);
  const autoRecalc = useVolumeStore((s) => s.autoRecalc);

  // Leaving the tool ends a mask drawing, so the inspector's button does not stay pressed. Checked
  // against the store, not on every unmount: StrictMode's re-mount keeps the tool active.
  useEffect(
    () => () => {
      if (tools.getState().active !== "volume") useVolumeStore.getState().setDrawing(null);
    },
    [tools],
  );
  // Esc with no draft clears the selection: a mask has nothing left to belong to.
  useEffect(() => {
    if (drawing && selection?.kind !== "volume") setDrawing(null);
  }, [drawing, selection, setDrawing]);

  useEffect(() => {
    if (!completed || completed.toolId !== "volume" || completed.geometry.type !== "Polygon") return;
    const ring = openRing(completed.geometry.coordinates[0]);
    clearCompleted();
    if (drawing && selection?.kind === "volume") {
      void saveMask(api, projectId, selection.id, drawing, ring, frame, autoRecalc).then(() => {
        setDrawing(null);
        activate("select");
      });
      return;
    }
    void createFromRing(api, projectId, layers, r, ring).then((id) => {
      if (!id) return;
      select(volumeSelection(id));
      activate("select");
    });
  }, [completed]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
