import { useEffect, useState } from "react";
import type { Image as ImageRow } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchLatestImages } from "@/api/overview";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

export const LATEST_IMAGES = 8;

/** One bounded page of the newest frames, shared by the mosaic hero and the imagery pane. */
export function useLatestImages(projectId: string, enabled: boolean) {
  const api = useApi();
  const dataRev = useChangesStore((s) => s.dataRevision);
  const [state, setState] = useState<{ projectId: string; images: ImageRow[]; failed: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetchLatestImages(api, projectId, LATEST_IMAGES)
      .then((images) => live && setState({ projectId, images, failed: false }))
      .catch((e: unknown) => {
        pushLog(`latest images unavailable: ${messageOf(e, String(e))}`);
        if (live) setState({ projectId, images: [], failed: true });
      });
    return () => {
      live = false;
    };
  }, [api, projectId, enabled, dataRev]);
  // A read that belongs to another project is never shown: null until this project's read lands.
  return state && state.projectId === projectId
    ? { images: state.images, failed: state.failed }
    : { images: null as ImageRow[] | null, failed: false };
}
