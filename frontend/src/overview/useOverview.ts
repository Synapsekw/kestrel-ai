import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import { listActivity, listFindings, type Activity, type Finding } from "@/api/findings";
import { fetchJobs } from "@/api/jobs";
import { fetchOverview, type ProjectOverview } from "@/api/overview";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";

export const OVERVIEW_RECENT = 5;
export const OVERVIEW_ACTIVITY = 8;
const OVERVIEW_JOBS = 10;
export const BURST_DEBOUNCE_MS = 400;

interface Loaded {
  projectId: string;
  overview: ProjectOverview | null;
  recent: Finding[];
  activity: Activity[];
  /** A failed list read degrades its own block only (the block says so). */
  recentFailed: boolean;
  activityFailed: boolean;
  error: string | null;
  code: string | null;
}

/** The Overview's reads (F §9.1, §14): one pre-aggregated payload plus three bounded lists. */
export function useOverview(projectId: string) {
  const api = useApi();
  const findingsRev = useChangesStore((s) => s.findingsRevision);
  const dataRev = useChangesStore((s) => s.dataRevision);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tick, setTick] = useState(0);
  const loadedFor = useRef<string | null>(null);
  const readTick = useRef(tick);

  useEffect(() => {
    let cancelled = false;
    // The first read and a Retry are immediate; a burst of change events collapses into one re-read.
    const retry = readTick.current !== tick;
    readTick.current = tick;
    const delay = loadedFor.current === projectId && !retry ? BURST_DEBOUNCE_MS : 0;
    const timer = window.setTimeout(() => {
      void Promise.allSettled([
        fetchOverview(api, projectId),
        listFindings(api, projectId, { sort: "-updated_at", limit: OVERVIEW_RECENT }),
        listActivity(api, projectId, { limit: OVERVIEW_ACTIVITY }),
      ]).then(([o, r, a]) => {
        if (cancelled) return;
        loadedFor.current = projectId;
        if (r.status === "rejected")
          pushLog(`recent findings unavailable: ${messageOf(r.reason, String(r.reason))}`);
        if (a.status === "rejected")
          pushLog(`activity unavailable: ${messageOf(a.reason, String(a.reason))}`);
        if (o.status === "rejected")
          pushLog(`overview unavailable: ${messageOf(o.reason, String(o.reason))}`);
        setLoaded((prev) => ({
          projectId,
          // A failed background re-read keeps the last good payload on screen (with a notice).
          overview: o.status === "fulfilled" ? o.value : prev?.projectId === projectId ? prev.overview : null,
          recent: r.status === "fulfilled" ? r.value.items : [],
          activity: a.status === "fulfilled" ? a.value.items : [],
          recentFailed: r.status === "rejected",
          activityFailed: a.status === "rejected",
          error: o.status === "rejected" ? messageOf(o.reason, "could not load the overview") : null,
          code: o.status === "rejected" ? codeOf(o.reason) : null,
        }));
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api, projectId, findingsRev, dataRev, tick]);

  // Running jobs come from the WebSocket store; seed it with this project's newest jobs once.
  useEffect(() => {
    fetchJobs(api, projectId, { limit: OVERVIEW_JOBS })
      .then((jobs) => useJobsStore.getState().upsertMany(jobs))
      .catch((e: unknown) => pushLog(`jobs unavailable: ${messageOf(e, String(e))}`));
  }, [api, projectId]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = loaded?.projectId === projectId ? loaded : null;
  const kept = Boolean(current?.overview);
  return {
    overview: current?.overview ?? null,
    recent: current?.recent ?? [],
    activity: current?.activity ?? [],
    recentFailed: current?.recentFailed ?? false,
    activityFailed: current?.activityFailed ?? false,
    /** The overview read failed and nothing is on screen: the whole page is an Alert. */
    error: kept ? null : (current?.error ?? null),
    /** A re-read failed while an earlier payload is still shown. */
    refreshError: kept ? (current?.error ?? null) : null,
    code: current?.code ?? null,
    loading: current === null,
    reload,
  };
}
