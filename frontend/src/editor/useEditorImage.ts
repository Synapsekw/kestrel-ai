import { useEffect, useState } from "react";
import { fetchBoxes } from "@/api/boxes";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { fetchImage, preannotateImage } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useEditorStore } from "@/store/editor";

/**
 * Loads the image record and its boxes into the editor store, runs pre-annotation on open when the
 * image has no unreviewed proposals (spec section 7), and reloads boxes when a job changes them.
 */
export function useEditorImage(
  projectId: string,
  imageId: string,
  preannotationModelId: string | null,
): { loading: boolean } {
  const api = useApi();
  const revision = useChangesStore((s) => s.boxesRevision[imageId] ?? 0);
  // `loading` is derived: the id of the last image whose load settled versus the requested one.
  const [settledId, setSettledId] = useState<string | null>(null);

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
        const hasPending = boxes.some((b) => b.review_state === "unreviewed");
        if (hasPending || !preannotationModelId) return;
        try {
          const result = await preannotateImage(api, projectId, imageId);
          if (cancelled) return;
          const store = useEditorStore.getState();
          result.items.forEach((b) => store.upsertBox(b));
          const n = result.items.length;
          if (!result.skipped)
            store.setNotice(`${n} ${n === 1 ? "proposal" : "proposals"} from the pre-annotation model`);
        } catch (e) {
          if (cancelled) return;
          pushLog(`preannotate failed: ${messageOf(e, String(e))}`);
          useEditorStore
            .getState()
            .setNotice(
              isNotImplemented(e)
                ? "Pre-annotation is not available yet"
                : `Pre-annotation failed: ${messageOf(e, "unknown error")}`,
            );
        }
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
  }, [api, projectId, imageId, preannotationModelId]);

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

  return { loading: settledId !== imageId };
}
