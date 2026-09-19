import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJobs } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";

/** This project's `results_export` jobs, newest first; kept fresh by the jobs panel's websocket too. */
function selectResultsExportJobs(jobs: Record<string, Job>, projectId: string): Job[] {
  return Object.values(jobs)
    .filter((j) => j.type === "results_export" && j.project_id === projectId)
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
  const jobs = useMemo(() => selectResultsExportJobs(stored, projectId), [stored, projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchJobs(api, projectId, { type: "results_export" })
      .then((loaded) => {
        if (cancelled) return;
        useJobsStore.getState().upsertMany(loaded);
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
