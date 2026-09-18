import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchImagePage } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { useEditorStore, waitForIdle } from "@/store/editor";
import { useNavigationStore } from "@/store/navigation";

/** Ctrl+Right / Ctrl+Left over the list that opened the editor; auto-save = wait for in-flight box calls. */
export function useEditorNavigation(
  projectId: string,
  imageId: string,
): {
  next: () => void;
  prev: () => void;
  position: { index: number; count: number } | null;
} {
  const api = useApi();
  const navigate = useNavigate();
  const ids = useNavigationStore((s) => s.ids);
  const setContext = useNavigationStore((s) => s.setContext);
  const known = ids.includes(imageId);

  useEffect(() => {
    if (known) return;
    let cancelled = false;
    fetchImagePage(api, projectId, { sort: "path", order: "asc", limit: 1000 })
      .then((page) => {
        if (!cancelled)
          setContext(
            page.items.map((i) => i.id),
            "data",
          );
      })
      .catch((e: unknown) => pushLog(`navigation context failed: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, known, setContext]);

  const position = useMemo(() => {
    const index = ids.indexOf(imageId);
    return index >= 0 ? { index, count: ids.length } : null;
  }, [ids, imageId]);

  const go = useCallback(
    (target: string | null) => {
      if (!target) return;
      void waitForIdle(useEditorStore).then(() => navigate(`/p/${projectId}/edit/${target}`));
    },
    [navigate, projectId],
  );

  const next = useCallback(() => go(useNavigationStore.getState().neighbours(imageId).next), [go, imageId]);
  const prev = useCallback(() => go(useNavigationStore.getState().neighbours(imageId).prev), [go, imageId]);

  return { next, prev, position };
}
