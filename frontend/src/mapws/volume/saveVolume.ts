import type { ApiClient, VolumeMeasurement } from "@contract/client";
import { calculateVolume, patchVolume, type VolumeMeasurementPatch } from "@/api/volumes";
import { useJobsStore } from "@/store/jobs";

const INPUTS = ["polygon_native", "polygon_site", "top_surface_id", "base", "masks", "alignment"] as const;

/** Name and material are not calculation inputs (spec §10: material does not make results stale). */
export function touchesInputs(patch: VolumeMeasurementPatch): boolean {
  return INPUTS.some((k) => k in patch);
}

export async function recalculate(api: ApiClient, projectId: string, id: string): Promise<VolumeMeasurement> {
  const started = await calculateVolume(api, projectId, id);
  useJobsStore.getState().upsert(started.job);
  return started.measurement;
}

/** PATCH, then — with auto-recalculate on and an input changed — start `volume_calc` (spec §10). */
export async function saveVolume(
  api: ApiClient,
  projectId: string,
  id: string,
  patch: VolumeMeasurementPatch,
  autoRecalc: boolean,
): Promise<VolumeMeasurement> {
  const m = await patchVolume(api, projectId, id, patch);
  if (!autoRecalc || !touchesInputs(patch)) return m;
  return recalculate(api, projectId, id);
}
