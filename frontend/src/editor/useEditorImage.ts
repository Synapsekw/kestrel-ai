import { useEffect, useState } from "react";
import { fetchBoxes } from "@/api/boxes";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchImage } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useEditorStore } from "@/store/editor";

/**
 * Loads the image record and its boxes into the editor store, and reloads boxes when a job changes
 * them. Pre-annotation on open is gone (image inspection spec §11.2): detection is the Images
 * workspace's **D** (`POST /images/{id}/detect`), which this interim editor does not have.
 */
export function useEditorImage(projectId: string, imageId: string): { loading: boolean } {
  const api = useApi();
  const revision = useChangesStore((s) => s.boxesRevision[imageId] ?? 0);
  // `loading` is derived: the id of the last image whose load settled versus the requested one.
  const [settledId, setSettledId] = useState<string | null>(null);
  const loadedId = useEditorStore((s) => s.imageId);

  useEffect(() => {
    let cancelled = false;
    useEditorStore.getState().reset();
    void (async () => {
      try {
        const [image, boxes] = await Promise.all([
          fetchImage(api, projectId, imageId),
          fetchBoxes(api, projectId, imageId),
        ]);
        if (cancelled) return;
        useEditorStore.getState().loadImage(image, boxes);
        setSettledId(imageId);
      } catch (e) {
        if (cancelled) return;
        pushLog(`load image failed: ${messageOf(e, String(e))}`);
        useEditorStore.getState().setError(messageOf(e, "could not load the image"));
        setSettledId(imageId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, projectId, imageId]);

  useEffect(() => {
    if (revision === 0) return;
    let cancelled = false;
    fetchBoxes(api, projectId, imageId)
      .then((boxes) => {
        if (!cancelled && useEditorStore.getState().imageId === imageId)
          useEditorStore.getState().setBoxes(boxes);
      })
      .catch((e: unknown) => pushLog(`reload boxes failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, imageId, revision]);

  // The store's own image id decides first: it commits in the same render as the image and its
  // boxes (store updates render synchronously), while `settledId` is a state update React commits
  // a task later, a window in which hotkeys gated on `loading` would drop keys on a visible image.
  // `settledId` still ends loading for a failed load, which never puts an image in the store.
  return { loading: loadedId !== imageId && settledId !== imageId };
}
