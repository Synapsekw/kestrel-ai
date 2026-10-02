import { useCallback, useEffect, useRef, useState } from "react";
import type { AssetSourceRef, Image as ImageRow } from "@contract/client";
import { useApi } from "@/api/client";
import { listDataItems, type DataItem } from "@/api/dataItems";
import { messageOf } from "@/api/errors";
import { IMAGE_PAGE_SIZE, fetchImagePage } from "@/api/images";

/** A run takes at most this many sources (`AssetModelRunStart.sources`, 1..50). */
export const MAX_SOURCES = 50;
/** Drawings and clouds per project are few; one bounded page of each. */
export const DATA_LIMIT = 200;

export const sourceKey = (r: AssetSourceRef) => `${r.type}:${r.id}`;

/** One bounded page of the project's drawings or point clouds. */
export function useDataSources(projectId: string, type: "drawing" | "point_cloud") {
  const api = useApi();
  const [state, setState] = useState<{ items: DataItem[] | null; error: string | null }>({
    items: null,
    error: null,
  });
  useEffect(() => {
    let live = true;
    listDataItems(api, projectId, { type: [type], limit: DATA_LIMIT }).then(
      (page) => live && setState({ items: page.items.filter((i) => i.type === type), error: null }),
      (e: unknown) => live && setState({ items: [], error: messageOf(e, "could not load the list") }),
    );
    return () => {
      live = false;
    };
  }, [api, projectId, type]);
  return state;
}

interface PhotoState {
  key: string;
  items: ImageRow[];
  next: string | null;
  total: number | null;
  loading: boolean;
  error: string | null;
}

/**
 * The project's photos, `IMAGE_PAGE_SIZE` (200) at a time: the first page for `search`, and `more()`
 * adds the next by cursor. Never the whole image set; a new search starts afresh and drops answers
 * for an older one.
 */
export function usePhotoSources(projectId: string, search: string) {
  const api = useApi();
  const key = `${projectId}/${search}`;
  const [state, setState] = useState<PhotoState | null>(null);
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  /** Reads one page and merges it in; no state changes before the answer (the first page shows as loading by key). */
  const fetchPage = useCallback(
    (cursor: string | null) => {
      const at = key;
      fetchImagePage(api, projectId, {
        limit: IMAGE_PAGE_SIZE,
        sort: "path",
        order: "asc",
        ...(search ? { search } : {}),
        ...(cursor ? { cursor } : {}),
      }).then(
        (page) => {
          if (keyRef.current !== at) return;
          setState((s) => {
            const before = s && s.key === at && cursor ? s.items : [];
            const seen = new Set(before.map((i) => i.id));
            return {
              key: at,
              items: [...before, ...page.items.filter((i) => !seen.has(i.id))],
              // The Prism mock repeats a cursor forever: a repeat ends the list.
              next: page.next_cursor && page.next_cursor !== cursor ? page.next_cursor : null,
              total: page.total ?? null,
              loading: false,
              error: null,
            };
          });
        },
        (e: unknown) => {
          if (keyRef.current !== at) return;
          setState((s) => ({
            key: at,
            items: s && s.key === at ? s.items : [],
            next: s && s.key === at ? s.next : null,
            total: s && s.key === at ? s.total : null,
            loading: false,
            error: messageOf(e, "could not load the photos"),
          }));
        },
      );
    },
    [api, projectId, search, key],
  );

  useEffect(() => fetchPage(null), [fetchPage]);
  const current = state && state.key === key ? state : null;
  const next = current?.next ?? null;
  const more = useCallback(() => {
    if (!next) return;
    setState((s) => (s && s.key === key ? { ...s, loading: true, error: null } : s));
    fetchPage(next);
  }, [fetchPage, next, key]);
  return {
    items: current?.items ?? null,
    total: current?.total ?? null,
    hasMore: !!next,
    loading: !current || current.loading,
    error: current?.error ?? null,
    more,
  };
}
