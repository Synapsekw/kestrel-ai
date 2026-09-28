import { useEffect } from "react";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { listMapMeasurementsInFrame } from "@/api/mapMeasurements";
import { useChangesStore } from "@/store/changes";
import { toast } from "@/ui";
import type { SiteFrame } from "@/mapws/annotations/bindings";
import { useMeasurementsStore } from "./store";

/**
 * The Measurements layer's read (spec §13): 500 a page, at most 4 pages (≤ 2 000 rows), once per
 * `mapMeasurementsRevision` or site-frame change. `enabled` is false on the left map of
 * Side-by-side, which draws from the same store.
 */
export function useMeasurementsLoader(projectId: string, frame: SiteFrame, enabled: boolean): void {
  const api = useApi();
  const revision = useChangesStore((s) => s.mapMeasurementsRevision);
  const frameKey = `${frame.kind}:${frame.epsg ?? ""}:${frame.proj4 ?? ""}`;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    listMapMeasurementsInFrame(api, projectId)
      .then((r) => {
        if (live) useMeasurementsStore.getState().set(r.items, r.truncated);
      })
      .catch((e: unknown) => {
        if (live && !isNotImplemented(e)) toast("danger", messageOf(e, "Could not load the measurements."));
      });
    return () => {
      live = false;
    };
  }, [api, projectId, revision, frameKey, enabled]);
}
