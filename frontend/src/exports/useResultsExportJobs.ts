import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJobs } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";

/** This project's file-producing exports (a `results_export` from the Export screen or a
 * `map_export` from the Maps screen), newest first across both kinds; kept fresh by the jobs
 * panel's websocket too. */
function selectExportJobs(jobs: Record<string, Job>, projectId: string): Job[] {
  return Object.values(jobs)
    .filter((j) => (j.type === "results_export" || j.type === "map_export") && j.project_id === projectId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function useResultsExportJobs(projectId: string): {
  jobs: Job[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${attempt}`;
  const [status, setStatus] = useState<{ key: string; error: string | null }>({ key: "", error: null });
  const stored = useJobsStore((s) => s.jobs);
  const jobs = useMemo(() => selectExportJobs(stored, projectId), [stored, projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    // The list endpoint's `type` filter takes one value, so a map export (a different job type)
    // needs its own request; both land in the same job store and are merged by `selectExportJobs`.
    Promise.all([
      fetchJobs(api, projectId, { type: "results_export" }),
      fetchJobs(api, projectId, { type: "map_export" }),
    ])
      .then(([resultsExports, mapExports]) => {
        if (cancelled) return;
        useJobsStore.getState().upsertMany([...resultsExports, ...mapExports]);
        setStatus({ key, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load past exports failed: ${messageOf(e, String(e))}`);
        setStatus({ key, error: messageOf(e, "could not load past exports") });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const loaded = status.key === key;
  return { jobs, loading: !loaded, error: loaded ? status.error : null, reload };
}
