import { useEffect, useState } from "react";
import { fetchBoxes } from "@/api/boxes";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { fetchImageDetail, listImageMeasurements } from "@/api/shapes";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useImagesWorkspace } from "@/store/imagesWorkspace";

/**
 * Loads one image into the workspace store: ImageDetail, its shapes (≤ 5,000) and its length
 * measurements (≤ 500), in parallel; reloads the shapes when a job changes them. The previous
 * image stays on screen until the new one has arrived (no blank flash between frames).
 */
export function useImageData(projectId: string, imageId: string): { loading: boolean; error: string | null } {
  const api = useApi();
  const revision = useChangesStore((s) => s.boxesRevision[imageId] ?? 0);
  const loadedId = useImagesWorkspace((s) => s.imageId);
  const [settled, setSettled] = useState<{ id: string; error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    useImagesWorkspace.getState().setProject(projectId);
    void (async () => {
      try {
        const [image, boxes, measurements] = await Promise.all([
          fetchImageDetail(api, projectId, imageId),
          fetchBoxes(api, projectId, imageId),
          // BA fills this route; until then it answers 501 and the image simply has no lengths.
          listImageMeasurements(api, projectId, imageId).catch((e: unknown) => {
            if (isNotImplemented(e)) return [];
            throw e;
          }),
        ]);
        if (cancelled) return;
        useImagesWorkspace.getState().loadImage(image, boxes, measurements);
        setSettled({ id: imageId, error: null });
      } catch (e) {
        if (cancelled) return;
        pushLog(`load image failed: ${messageOf(e, String(e))}`);
        setSettled({ id: imageId, error: messageOf(e, "Could not load the image.") });
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
        if (!cancelled && useImagesWorkspace.getState().imageId === imageId)
          useImagesWorkspace.getState().setBoxes(boxes);
      })
      .catch((e: unknown) => pushLog(`reload shapes failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, imageId, revision]);

  const mine = settled?.id === imageId ? settled : null;
  return { loading: loadedId !== imageId && !mine, error: mine?.error ?? null };
}
