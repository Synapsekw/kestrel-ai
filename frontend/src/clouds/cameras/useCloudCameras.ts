import { useEffect, useRef } from "react";
import type { PointCloud } from "@/api/clouds";
import { getCloudCameras } from "@/api/cloudCameras";
import { useApi } from "@/api/client";
import { ApiFailure, messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useCamerasStore } from "./store";

/**
 * C-L1 controller Ruling 4: a bump of only `imagesRevision`/`pointcloudsRevision` is coalesced
 * behind this trailing debounce, since `pointclouds.changed` also fires on every measurement save
 * and report-view PUT, and `boxes.changed` bumps `imagesRevision` — a refetch per bump would be a
 * storm of <=2 MB GETs during a bulk capture or a detect job.
 */
export const REVISION_REFETCH_MS = 1000;

/**
 * The latest request any hook instance has issued. Module-level, like the store it feeds: a request
 * from an instance that has since unmounted (the workspace left and reopened on the same cloud) is
 * superseded by the new instance's first request and cannot land after it (final review I1).
 */
let latestSeq = 0;

/**
 * Loads the open cloud's cameras (spec §13: once per cloud open and on `images.changed`; C-L1
 * Ruling 4 adds `pointclouds.changed`, the cloud's CRS, and a failed offset save via `reloadTick`).
 *
 * A change of cloud id, of the CRS key, or of `reloadTick` fetches at once. A change of only the
 * revision counters instead (re)starts a `REVISION_REFETCH_MS` timer, so a burst of bumps sends one
 * request after the pause (while a request from before the pause may still be in flight, or a
 * request from a previous cloud open). Every request carries a module-level sequence number and only
 * the answer of the latest request any instance of the hook has issued is allowed to land — a stale
 * one, for this cloud or a previous one, or from an instance that has unmounted, is dropped even if
 * it resolves after the newer one (the store's `receive`/`fail` additionally drop anything that does
 * not belong to the store's current `cloudId`). A hook instance's first run resets the store.
 *
 * A plain hook with no dependency on the viewer, so it can run in the always-mounted cameras
 * feature rather than the layer, which mounts only while the view is running (controller Ruling 3).
 */
export function useCloudCameras(projectId: string, cloud: PointCloud | null): void {
  const api = useApi();
  const imagesRevision = useChangesStore((s) => s.imagesRevision);
  const pointcloudsRevision = useChangesStore((s) => s.pointcloudsRevision);
  const reloadTick = useCamerasStore((s) => s.reloadTick);
  const cloudId = cloud?.status === "ready" ? cloud.id : null;
  const crsKey = cloud ? `${cloud.epsg ?? ""}|${cloud.proj4 ?? ""}` : "";

  /** The last (cloudId, crsKey, reloadTick) combination fetched at once; a run whose combination
   * differs is an "open" (a fresh cloud, a CRS just assigned, or an explicit reload) and fetches
   * immediately. A run with the same combination is a revision-only bump and gets debounced. */
  const immediateKey = useRef<string | null>(null);
  /** The revision pair the latest request was sent for. A run with the same combination and the same
   * pair has nothing new to fetch: StrictMode's mount, unmount, mount re-runs the effect that way, and
   * a second GET a pause later would land a fresh `set` after the view settled, so the glyph overlay
   * is set again and the render loop wakes for another second (C-L1 idle-frame debug). */
  const fetchedRevisions = useRef<string | null>(null);
  const revisions = `${imagesRevision}|${pointcloudsRevision}`;

  useEffect(() => {
    if (!cloudId) {
      immediateKey.current = null;
      fetchedRevisions.current = null;
      if (useCamerasStore.getState().cloudId !== null) useCamerasStore.getState().reset(null);
      return;
    }

    const fetchNow = () => {
      fetchedRevisions.current = revisions;
      const mySeq = ++latestSeq;
      getCloudCameras(api, projectId, cloudId)
        .then((set) => {
          if (latestSeq !== mySeq) return; // superseded by a newer request, from any instance
          useCamerasStore.getState().receive(cloudId, set);
        })
        .catch((e: unknown) => {
          if (latestSeq !== mySeq) return;
          if (e instanceof ApiFailure && e.code === "needs_coordinates") {
            useCamerasStore.getState().fail(cloudId, "needs_coordinates", null);
            return;
          }
          const message = messageOf(e, "could not load the drone photos");
          pushLog(`cameras for ${cloudId} failed: ${message}`);
          useCamerasStore.getState().fail(cloudId, "error", message);
        });
    };

    const key = `${cloudId}|${crsKey}|${reloadTick}`;
    // A hook instance's first run is a cloud open even when the store still holds this cloud: the
    // store outlives the workspace, and its payload (and the operator's switch choice, P10) belong to
    // the previous open. Refs survive StrictMode's simulated remount, so that re-run is not a first run.
    const firstRun = immediateKey.current === null;
    const isOpenOrReload = immediateKey.current !== key;
    immediateKey.current = key;

    if (isOpenOrReload) {
      if (firstRun || useCamerasStore.getState().cloudId !== cloudId)
        useCamerasStore.getState().reset(cloudId);
      fetchNow();
      return;
    }
    if (fetchedRevisions.current === revisions) return;

    const timer = window.setTimeout(fetchNow, REVISION_REFETCH_MS);
    return () => window.clearTimeout(timer);
  }, [api, projectId, cloudId, crsKey, reloadTick, revisions]);
}
