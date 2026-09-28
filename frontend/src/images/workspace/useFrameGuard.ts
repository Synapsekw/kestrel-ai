import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/ui";

export const DELETED_TOAST = "That image was deleted. Showing the next one.";

/**
 * §16 "frame deleted while open" (Ruling 13): the open image left an index that contained it. `ids`
 * is null while the index is not ready; null forgets what was seen, so a filter change (a new
 * query, which is not ready at first) never reads as a delete — only a re-read of the same query
 * does. A deep link never in the index does not trigger it.
 *
 * I1 (final review): leaving a FILTERED index is not a deletion (an unlabeled frame gets its first
 * box, the last suggestion is accepted, N marks it empty). It moves on only when the filters are
 * the defaults, or when FC's load confirms the frame is gone (`gone`: a 404 for this id).
 */
export function useFrameGuard(
  projectId: string,
  imageId: string | null,
  ids: readonly string[] | null,
  { filtered, gone }: { filtered: boolean; gone: boolean },
): void {
  const navigate = useNavigate();
  const seen = useRef<{ id: string; ordinal: number } | null>(null);
  const moved = useRef<string | null>(null);
  useEffect(() => {
    if (!ids) {
      seen.current = null;
      return;
    }
    if (!imageId || moved.current === imageId) return;
    const i = ids.indexOf(imageId);
    if (i >= 0) {
      seen.current = { id: imageId, ordinal: i };
      return;
    }
    const was = seen.current;
    if (!was || was.id !== imageId) return;
    if (filtered && !gone) return;
    const next = ids[was.ordinal] ?? ids[was.ordinal - 1] ?? null;
    moved.current = imageId;
    seen.current = null;
    toast("info", DELETED_TOAST);
    void navigate(next ? `/p/${projectId}/images/${next}` : `/p/${projectId}/images`, { replace: true });
  }, [ids, imageId, navigate, projectId, filtered, gone]);
}
