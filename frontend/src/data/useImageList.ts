import { useCallback, useEffect, useRef, useState } from "react";
import type { Image as ImageRow } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchImagePage, IMAGE_PAGE_SIZE, type ListImagesQuery } from "@/api/images";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";

export interface ImageList {
  items: ImageRow[];
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface State {
  /** The request key the data belongs to; `loading` is derived from `key !== requestKey`. */
  key: string | null;
  items: ImageRow[];
  total: number;
  cursor: string | null;
  error: string | null;
  more: boolean;
}

/**
 * Cursor-paginated image listing; the first page reloads whenever the query, the project or
 * `imagesRevision` changes. Loading is derived from a request key instead of set inside the
 * effect (React Compiler rule `set-state-in-effect`); stale rows stay visible while reloading.
 */
export function useImageList(
  projectId: string,
  query: ListImagesQuery,
  pageSize = IMAGE_PAGE_SIZE,
): ImageList {
  const api = useApi();
  const imagesRevision = useChangesStore((s) => s.imagesRevision);
  const [attempt, setAttempt] = useState(0);
  const queryKey = JSON.stringify(query);
  const requestKey = `${projectId}|${queryKey}|${pageSize}|${imagesRevision}|${attempt}`;
  const [state, setState] = useState<State>({
    key: null,
    items: [],
    total: 0,
    cursor: null,
    error: null,
    more: false,
  });
  const loadingMore = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchImagePage(api, projectId, { ...(JSON.parse(queryKey) as ListImagesQuery), limit: pageSize })
      .then((page) => {
        if (cancelled) return;
        setState({
          key: requestKey,
          items: page.items,
          total: page.total,
          cursor: page.next_cursor,
          error: null,
          more: false,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`list images failed: ${messageOf(e, String(e))}`);
        setState((s) => ({
          ...s,
          key: requestKey,
          error: messageOf(e, "could not load images"),
          more: false,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, queryKey, pageSize, requestKey]);

  const loaded = state.key === requestKey;
  const cursor = loaded ? state.cursor : null;

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    setState((s) => ({ ...s, more: true }));
    fetchImagePage(api, projectId, { ...(JSON.parse(queryKey) as ListImagesQuery), limit: pageSize, cursor })
      .then((page) => {
        setState((s) =>
          s.key === requestKey
            ? {
                ...s,
                items: [...s.items, ...page.items],
                total: page.total,
                cursor: page.next_cursor,
                more: false,
              }
            : s,
        );
      })
      .catch((e: unknown) => {
        pushLog(`load more images failed: ${messageOf(e, String(e))}`);
        setState((s) => ({ ...s, error: messageOf(e, "could not load more images"), more: false }));
      })
      .finally(() => {
        loadingMore.current = false;
      });
  }, [api, projectId, queryKey, pageSize, cursor, requestKey]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);

  return {
    items: state.items,
    total: state.total,
    loading: !loaded || state.more,
    error: loaded ? state.error : null,
    hasMore: cursor !== null,
    loadMore,
    reload,
  };
}
