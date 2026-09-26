import { useCallback, useEffect, useRef, useState } from "react";
import { messageOf } from "@/api/errors";
import { isLibraryUnavailable } from "@/api/library";
import type { Page } from "@/api/paging";
import { pushLog } from "@/app/diagnostics";

export interface PagedList<T> {
  items: T[];
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  remove: (id: string) => void;
  put: (item: T) => void;
}

interface State<T> {
  key: number;
  items: T[];
  cursor: string | null;
  unavailable: boolean;
  error: string | null;
}

/** A cursor-paged library list: page one on mount and on reload, later pages on demand. */
export function usePagedList<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<Page<T>>,
  what: string,
): PagedList<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State<T>>({
    key: -1,
    items: [],
    cursor: null,
    unavailable: false,
    error: null,
  });
  const fetchRef = useRef(fetchPage);
  const busy = useRef(false);
  useEffect(() => {
    fetchRef.current = fetchPage;
  }, [fetchPage]);

  useEffect(() => {
    let cancelled = false;
    fetchRef
      .current()
      .then((page) => {
        if (!cancelled)
          setState({
            key: attempt,
            items: page.items,
            cursor: page.next_cursor,
            unavailable: false,
            error: null,
          });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load ${what} failed: ${messageOf(e, String(e))}`);
        const unavailable = isLibraryUnavailable(e);
        setState((s) => ({
          key: attempt,
          items: unavailable ? [] : s.items,
          cursor: null,
          unavailable,
          error: unavailable ? null : messageOf(e, `could not load ${what}`),
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt, what]);

  const cursor = state.cursor;
  const loadMore = useCallback(() => {
    if (!cursor || busy.current) return;
    busy.current = true;
    fetchRef
      .current(cursor)
      .then((page) =>
        setState((s) => {
          const seen = new Set(s.items.map((i) => i.id));
          return {
            ...s,
            items: [...s.items, ...page.items.filter((i) => !seen.has(i.id))],
            cursor: page.next_cursor === cursor ? null : page.next_cursor,
          };
        }),
      )
      .catch((e: unknown) => pushLog(`load more ${what} failed: ${messageOf(e, String(e))}`))
      .finally(() => {
        busy.current = false;
      });
  }, [cursor, what]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const remove = useCallback(
    (id: string) => setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) })),
    [],
  );
  const put = useCallback(
    (item: T) =>
      setState((s) => ({
        ...s,
        items: s.items.some((i) => i.id === item.id)
          ? s.items.map((i) => (i.id === item.id ? item : i))
          : [item, ...s.items],
      })),
    [],
  );

  return {
    items: state.items,
    loading: state.key !== attempt && state.items.length === 0,
    unavailable: state.unavailable,
    error: state.error,
    hasMore: cursor !== null,
    loadMore,
    reload,
    remove,
    put,
  };
}
