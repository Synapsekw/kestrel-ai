import { useCallback, useEffect, useState } from "react";
import type { Surface, VolumeMeasurement } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listSurfaces } from "@/api/surfaces";
import { fetchVolume, type VolumeMeasurementPatch } from "@/api/volumes";
import { pushLog } from "@/app/diagnostics";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useChangesStore } from "@/store/changes";
import { toast } from "@/ui";
import { recalculate, saveVolume } from "./saveVolume";
import { useVolumeStore } from "./volumeStore";

/** A user-initiated write failed: log it and tell the operator (T16-1). */
function reportWrite(action: string, err: unknown): void {
  const message = messageOf(err, `could not ${action}`);
  pushLog(`${action} failed: ${message}`);
  toast("danger", message);
}

/** One measurement and the project's surfaces, kept current by events and finished `volume_calc` jobs. */
export function useVolume(
  projectId: string,
  id: string,
): {
  m: VolumeMeasurement | null;
  surfaces: Surface[];
  top: Surface | null;
  error: string | null;
  save: (patch: VolumeMeasurementPatch) => void;
  recalc: () => void;
  reload: () => void;
} {
  const api = useApi();
  const volumesRevision = useChangesStore((s) => s.volumesRevision);
  const surfacesRevision = useChangesStore((s) => s.surfacesRevision);
  // A deleted map finding rejects its detection and publishes only `findings.changed`, which can
  // make a masked volume stale without a `volumes.changed` event (M-B5 hand-off, ruling T6-1).
  const findingsRevision = useChangesStore((s) => s.findingsRevision);
  const autoRecalc = useVolumeStore((s) => s.autoRecalc);
  const [m, setM] = useState<VolumeMeasurement | null>(null);
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useOnJobsFinished("volume_calc", reload);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchVolume(api, projectId, id), listSurfaces(api, projectId)])
      .then(([vm, all]) => {
        if (cancelled) return;
        setM(vm);
        setSurfaces(all);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Background load failure: log it and show it inline, never a danger toast (T16-1).
        const message = messageOf(err, "could not load the measurement");
        pushLog(`load the measurement failed: ${message}`);
        setError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, id, volumesRevision, surfacesRevision, findingsRevision, tick]);

  const save = useCallback(
    (patch: VolumeMeasurementPatch) => {
      saveVolume(api, projectId, id, patch, autoRecalc)
        .then(setM)
        .catch((err: unknown) => reportWrite("save the change", err));
    },
    [api, projectId, id, autoRecalc],
  );
  const recalc = useCallback(() => {
    recalculate(api, projectId, id)
      .then(setM)
      .catch((err: unknown) => reportWrite("start the calculation", err));
  }, [api, projectId, id]);

  const top = (m && surfaces.find((s) => s.id === m.top_surface_id)) ?? null;
  return { m, surfaces, top, error, save, recalc, reload };
}
