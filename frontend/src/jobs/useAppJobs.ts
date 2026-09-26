import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { fetchAppJobs, type AppJob } from "@/api/appJobs";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";
import { SEGMENT_STATES, inSegment, mergeJobs, type JobSegment } from "./jobsFilters";

export const APP_JOBS_POLL_MS = 5000;
/** Running + queued jobs are few; one bounded page counts them. */
export const ACTIVE_COUNT_LIMIT = 100;

export interface AppJobsList {
  /** Loaded jobs of this segment, live from the jobs store (WebSocket). */
  rows: AppJob[];
  /** A loaded job by id even after it left the segment, else the store's copy. */
  find: (id: string) => AppJob | null;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface State {
  key: string;
  items: AppJob[];
  cursor: string | null;
  /** Once a later page is loaded, polling page one must not reset the cursor. */
  paged: boolean;
  error: string | null;
}

const INITIAL: State = { key: "", items: [], cursor: null, paged: false, error: null };

/**
 * `GET /jobs` for one segment and project filter. Page one is polled every 5 s and merged by id
 * (new jobs appear, finished ones update); later pages load on `loadMore` (the table's end).
 * Rows come through `store/jobs.ts`, so WebSocket progress and state changes show at once, and a
 * job that leaves the segment leaves the list without waiting for the next poll.
 */
export function useAppJobs(segment: JobSegment, project: string | null): AppJobsList {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${segment}|${project ?? ""}|${attempt}`;
  const [state, setState] = useState<State>(INITIAL);
  const loadingMore = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let failed = false;
    const tick = () => {
      fetchAppJobs(api, { state: SEGMENT_STATES[segment], project_id: project ?? undefined })
        .then((page) => {
          if (cancelled) return;
          failed = false;
          useJobsStore.getState().upsertMany(page.items);
          setState((s) =>
            s.key === key
              ? {
                  ...s,
                  items: mergeJobs(s.items, page.items),
                  cursor: s.paged ? s.cursor : page.next_cursor,
                  error: null,
                }
              : { key, items: page.items, cursor: page.next_cursor, paged: false, error: null },
          );
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          if (!failed) pushLog(`list app jobs failed: ${messageOf(e, String(e))}`);
          failed = true;
          const error = messageOf(e, "could not load the jobs");
          setState((s) => (s.key === key ? { ...s, error } : { ...INITIAL, key, error }));
        });
    };
    tick();
    const id = window.setInterval(tick, APP_JOBS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, key, segment, project]);

  const cursor = state.key === key ? state.cursor : null;
  const loadMore = useCallback(() => {
    if (!cursor || loadingMore.current) return;
    loadingMore.current = true;
    fetchAppJobs(api, { state: SEGMENT_STATES[segment], project_id: project ?? undefined, cursor })
      .then((page) => {
        useJobsStore.getState().upsertMany(page.items);
        setState((s) =>
          s.key === key
            ? {
                ...s,
                items: mergeJobs(s.items, page.items),
                // The Prism mock repeats its cursor forever; a repeat means there is no more.
                cursor: page.next_cursor === cursor ? null : page.next_cursor,
                paged: true,
              }
            : s,
        );
      })
      .catch((e: unknown) => pushLog(`load more jobs failed: ${messageOf(e, String(e))}`))
      .finally(() => {
        loadingMore.current = false;
      });
  }, [api, key, segment, project, cursor]);

  const live = useJobsStore((s) => s.jobs);
  const merged = useMemo(
    () => (state.key === key ? state.items : []).map((j) => ({ ...j, ...live[j.id] }) as AppJob),
    [state.key, state.items, key, live],
  );
  const rows = useMemo(() => merged.filter((j) => inSegment(segment, j.state)), [merged, segment]);
  const find = useCallback(
    (id: string) => merged.find((j) => j.id === id) ?? (live[id] as AppJob | undefined) ?? null,
    [merged, live],
  );
  const reload = useCallback(() => setAttempt((a) => a + 1), []);

  return {
    rows,
    find,
    loading: state.key !== key,
    error: state.key === key ? state.error : null,
    hasMore: cursor !== null,
    loadMore,
    reload,
  };
}

/** The Running and Queued counts (plan decision 4), polled with the list. */
export function useActiveJobCounts(project: string | null): { running: number; queued: number } {
  const api = useApi();
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetchAppJobs(api, {
        state: ["running", "queued"],
        project_id: project ?? undefined,
        limit: ACTIVE_COUNT_LIMIT,
      })
        .then((page) => {
          if (cancelled) return;
          useJobsStore.getState().upsertMany(page.items);
          setIds(page.items.map((j) => j.id));
        })
        .catch((e: unknown) => pushLog(`count active jobs failed: ${messageOf(e, String(e))}`));
    };
    tick();
    const id = window.setInterval(tick, APP_JOBS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, project]);
  const jobs = useJobsStore((s) => s.jobs);
  return useMemo(() => {
    let running = 0;
    let queued = 0;
    for (const id of ids) {
      const state = jobs[id]?.state;
      if (state === "running") running += 1;
      else if (state === "queued") queued += 1;
    }
    return { running, queued };
  }, [ids, jobs]);
}
