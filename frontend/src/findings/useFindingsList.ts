import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { listFindings, type Finding, type FindingListQuery } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { filtersToQuery, type FindingFilters } from "./filters";

/** Rows per keyset page; the table holds only loaded pages (F §14). */
export const FINDINGS_PAGE = 200;
/** A refresh re-reads at most this many rows from the top (the API's `limit` cap). */
export const FINDINGS_REFRESH_MAX = 500;
const REFRESH_DEBOUNCE_MS = 300;

interface Loaded {
  key: string;
  items: Finding[];
  cursor: string | null;
  error: string | null;
}

export interface FindingsList {
  items: Finding[];
  status: "loading" | "ready" | "error";
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

const EMPTY: Finding[] = [];

export function useFindingsList(projectId: string, filters: FindingFilters): FindingsList {
  const api = useApi();
  // Keyed on the serialised query, so a caller that builds a new filters object each render (a test,
  // a parent without useMemo) does not refetch in a loop.
  const queryJson = JSON.stringify(filtersToQuery(filters));
  const query = useMemo(() => JSON.parse(queryJson) as FindingListQuery, [queryJson]);
  const key = `${projectId}|${queryJson}`;
  const revision = useChangesStore((s) => s.findingsRevision);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const loadedRef = useRef<Loaded | null>(null);
  const fetchingMore = useRef(false);
  const handledRevision = useRef(revision);

  useEffect(() => {
    loadedRef.current = loaded;
  });

  // The first page, whenever the query (or a manual reload) changes.
  useEffect(() => {
    let cancelled = false;
    listFindings(api, projectId, { ...query, limit: FINDINGS_PAGE })
      .then((page) => {
        if (!cancelled) setLoaded({ key, items: page.items, cursor: page.next_cursor, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoaded({ key, items: [], cursor: null, error: messageOf(e, "could not load the findings") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key, query, reloadTick]);

  // `findings.changed`: re-read the rows already shown (bounded), without flashing a loading state.
  useEffect(() => {
    if (revision === handledRevision.current) return;
    handledRevision.current = revision;
    const timer = window.setTimeout(() => {
      const cur = loadedRef.current;
      const shown = cur && cur.key === key ? cur.items.length : 0;
      const limit = Math.min(FINDINGS_REFRESH_MAX, Math.max(FINDINGS_PAGE, shown));
      listFindings(api, projectId, { ...query, limit })
        .then((page) =>
          setLoaded((s) => (s && s.key === key ? { key, items: page.items, cursor: page.next_cursor, error: null } : s)),
        )
        .catch((e: unknown) => pushLog(`findings refresh failed: ${messageOf(e, String(e))}`));
    }, REFRESH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [api, projectId, key, query, revision]);

  const loadMore = useCallback(() => {
    const cur = loadedRef.current;
    if (!cur || cur.key !== key || !cur.cursor || fetchingMore.current) return;
    fetchingMore.current = true;
    const cursor = cur.cursor;
    listFindings(api, projectId, { ...query, limit: FINDINGS_PAGE, cursor })
      .then((page) =>
        setLoaded((s) => {
          if (!s || s.key !== key) return s;
          const seen = new Set(s.items.map((f) => f.id));
          return {
            key,
            items: [...s.items, ...page.items.filter((f) => !seen.has(f.id))],
            // A repeated cursor (the Prism mock) ends paging instead of looping.
            cursor: page.next_cursor === cursor ? null : page.next_cursor,
            error: null,
          };
        }),
      )
      .catch((e: unknown) => pushLog(`findings page failed: ${messageOf(e, String(e))}`))
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
