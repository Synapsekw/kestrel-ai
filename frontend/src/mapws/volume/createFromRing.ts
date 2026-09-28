import type { ApiClient } from "@contract/client";
import { createVolume, listVolumes } from "@/api/volumes";
import type { WorkspaceLayer } from "@/mapws/w4host";
import { useJobsStore } from "@/store/jobs";
import { toast } from "@/ui";
import { nextName } from "@/volumes/model";
import { reportWrite } from "./useVolume";
import { topLayerFor, volumeToolDisabled } from "./volumeModel";

/** U finished: POST /volumes on the r date's DSM with the ring in site coordinates (spec §10, R-W4-1). */
export async function createFromRing(
  api: ApiClient,
  projectId: string,
  layers: readonly WorkspaceLayer[],
  r: string | null,
  ring: number[][],
): Promise<string | null> {
  // The same pick as the tool's disabled reason (R-W4-14), so the two never disagree.
  const top = topLayerFor(layers, r);
  if (!top) {
    toast("info", volumeToolDisabled(layers, r) ?? "No DSM for this survey.");
    return null;
  }
  try {
    const existing = await listVolumes(api, projectId);
    const created = await createVolume(api, projectId, {
      name: nextName(existing),
      polygon_site: ring,
      top_surface_id: top.id,
      base: { kind: "toe_plane" },
    });
    useJobsStore.getState().upsert(created.job);
    return created.measurement.id;
  } catch (err) {
    // A user write failed: log it and say so (T16-1).
    reportWrite("create the volume measurement", err);
    return null;
  }
}
