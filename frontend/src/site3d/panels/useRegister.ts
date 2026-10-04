import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listAssetItems, type AssetItemRow, type ItemQuery } from "@/api/plantItems";

export interface RegisterState {
  rows: AssetItemRow[];
  loading: boolean;
  error: string | null;
  /** The last page has arrived. */
  done: boolean;
  loadMore(): void;
  retry(): void;
}

interface Loaded {
  key: string;
  rows: AssetItemRow[];
  next: string | null;
  /** The cursor of the last page applied (null = the first page). */
  at: string | null | undefined;
  error: string | null;
}

const EMPTY: Omit<Loaded, "key"> = { rows: [], next: null, at: undefined, error: null };

/**
 * A version's register as cursor pages for one query. A new query starts over and aborts the one in
 * flight, whose late answer is dropped (Review Focus 4); `loadMore` asks for the next page at most once.
 */
export function useRegister(
  projectId: string,
  modelId: string,
  version: number,
  query: ItemQuery,
): RegisterState {
  const api = useApi();
  const { q = "", type = "", area = "", flag } = query;
  const flagKey = flag ?? "";
  const key = [projectId, modelId, version, q, type, area, flagKey].join("\u0000");
  const [loaded, setLoaded] = useState<Loaded>({ key: "", ...EMPTY });
  const [want, setWant] = useState<{ key: string; cursor: string | null; attempt: number }>({
    key: "",
    cursor: null,
    attempt: 0,
  });
  // A new query forgets the old query's cursor, so coming back to a query starts at page 1.
  if (want.key !== key) setWant({ key, cursor: null, attempt: 0 });
  const cursor = want.key === key ? want.cursor : null;
  const attempt = want.key === key ? want.attempt : 0;
  const current: Loaded = loaded.key === key ? loaded : { key, ...EMPTY };

  useEffect(() => {
    const ctrl = new AbortController();
    const filters: ItemQuery = { q, type, area, ...(flagKey ? { flag: flagKey as ItemQuery["flag"] } : {}) };
    listAssetItems(api, projectId, modelId, version, filters, cursor, ctrl.signal).then(
      (page) => {
        if (ctrl.signal.aborted) return;
        setLoaded((prev) => ({
          key,
          rows: [...(cursor !== null && prev.key === key ? prev.rows : []), ...page.items],
          next: page.next_cursor ?? null,
          at: cursor,
          error: null,
        }));
      },
      (e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoaded((prev) => ({
          ...(prev.key === key ? prev : EMPTY),
          key,
          error: messageOf(e, "The register could not be loaded."),
        }));
      },
    );
    return () => ctrl.abort();
    // `attempt` re-runs the same request for a retry.
  }, [api, projectId, modelId, version, q, type, area, flagKey, key, cursor, attempt]);

  const loading = current.error === null && current.at !== cursor;
  const done = current.at === cursor && current.next === null && current.error === null;
  const next = current.next;
  const loadMore = useCallback(() => {
    if (loading || !next || current.error) return;
    setWant((w) => ({ key, cursor: next, attempt: w.key === key ? w.attempt : 0 }));
  }, [loading, next, current.error, key]);
  const retry = useCallback(() => {
    setLoaded((prev) => (prev.key === key ? { ...prev, error: null } : prev));
    setWant((w) => ({
      key,
      cursor: w.key === key ? w.cursor : null,
      attempt: (w.key === key ? w.attempt : 0) + 1,
    }));
  }, [key]);

  return { rows: current.rows, loading, error: current.error, done, loadMore, retry };
}
