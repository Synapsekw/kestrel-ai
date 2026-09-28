import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listMeasurements, type MeasurementItem, type MeasurementListQuery } from "@/api/measurements";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { filtersToQuery, type MeasurementFilters } from "./model";

/** Rows per keyset page; the table holds only loaded pages (Budget). */
export const MEASUREMENTS_PAGE = 200;
/** A refresh re-reads at most this many rows from the top (Assumption A2: within the API's `limit` cap of 1000). */
export const MEASUREMENTS_REFRESH_MAX = 500;
const REFRESH_DEBOUNCE_MS = 300;

/** Ids are unique per provider only, so a row is keyed by kind and id. */
export const rowKeyOf = (m: Pick<MeasurementItem, "kind" | "id">): string => `${m.kind}:${m.id}`;

interface Loaded {
  key: string;
  items: MeasurementItem[];
  cursor: string | null;
  error: string | null;
}

export interface MeasurementsList {
  items: MeasurementItem[];
  status: "loading" | "ready" | "error";
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

const EMPTY: MeasurementItem[] = [];

export function useMeasurementsList(projectId: string, filters: MeasurementFilters): MeasurementsList {
  const api = useApi();
  // Keyed on the serialised query, so a caller that builds a new filters object each render (a test,
  // a parent without useMemo) does not refetch in a loop.
  const queryJson = JSON.stringify(filtersToQuery(filters));
  const query = useMemo(() => JSON.parse(queryJson) as MeasurementListQuery, [queryJson]);
  const key = `${projectId}|${queryJson}`;
  const revision = useChangesStore((s) => s.measurementsRevision);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const loadedRef = useRef<Loaded | null>(null);
  const fetchingMore = useRef(false);
  const handledRevision = useRef(revision);
  const refreshSeq = useRef(0);

  // A layout effect, so a child's passive effect (DataTable's `onEndReached`) in the same commit
  // already sees this render's state, not the previous one.
  useLayoutEffect(() => {
    loadedRef.current = loaded;
  });

  // The first page, whenever the query (or a manual reload) changes.
  useEffect(() => {
    let cancelled = false;
    listMeasurements(api, projectId, { ...query, limit: MEASUREMENTS_PAGE })
      .then((page) => {
        if (!cancelled) setLoaded({ key, items: page.items, cursor: page.next_cursor, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setLoaded({ key, items: [], cursor: null, error: messageOf(e, "could not load the measurements") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key, query, reloadTick]);

  // A measurement event: re-read the rows already shown (bounded), without a loading state.
  useEffect(() => {
    if (revision === handledRevision.current) return;
    handledRevision.current = revision;
    const timer = window.setTimeout(() => {
      const cur = loadedRef.current;
      const shown = cur && cur.key === key ? cur.items.length : 0;
      const limit = Math.min(MEASUREMENTS_REFRESH_MAX, Math.max(MEASUREMENTS_PAGE, shown));
      // Only the latest refresh may land: an older response arriving late would roll the rows back.
      const seq = ++refreshSeq.current;
      listMeasurements(api, projectId, { ...query, limit })
        .then((page) => {
          if (seq !== refreshSeq.current) return;
          setLoaded((s) =>
            s && s.key === key ? { key, items: page.items, cursor: page.next_cursor, error: null } : s,
          );
        })
        .catch((e: unknown) => pushLog(`measurements refresh failed: ${messageOf(e, String(e))}`));
    }, REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [api, projectId, key, query, revision]);

  const loadMore = useCallback(() => {
    const cur = loadedRef.current;
    if (!cur || cur.key !== key || !cur.cursor || fetchingMore.current) return;
    fetchingMore.current = true;
    const cursor = cur.cursor;
    listMeasurements(api, projectId, { ...query, limit: MEASUREMENTS_PAGE, cursor })
      .then((page) =>
        setLoaded((s) => {
          if (!s || s.key !== key) return s;
          const seen = new Set(s.items.map(rowKeyOf));
          return {
            key,
            items: [...s.items, ...page.items.filter((m) => !seen.has(rowKeyOf(m)))],
            // A repeated cursor (the Prism mock) ends paging instead of looping.
            cursor: page.next_cursor === cursor ? null : page.next_cursor,
            error: null,
          };
        }),
      )
      .catch((e: unknown) => {
        const msg = messageOf(e, "could not load more measurements");
        pushLog(`measurements page failed: ${msg}`);
        // Shown above the rows kept so far; Retry reloads from the first page.
        setLoaded((s) => (s && s.key === key ? { ...s, error: msg } : s));
      })
      .finally(() => {
        fetchingMore.current = false;
      });
  }, [api, projectId, key, query]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);
  const current = loaded && loaded.key === key ? loaded : null;
  return {
    items: current?.items ?? EMPTY,
    status: !current ? "loading" : current.error ? "error" : "ready",
    error: current?.error ?? null,
    hasMore: Boolean(current?.cursor),
    loadMore,
    reload,
  };
}
