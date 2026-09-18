import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJobs } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";

export const LIST_POLL_MS = 5000;

/** Loads the project's recent jobs into the store while `enabled` (the panel is open) and every 5 s after. */
export function useJobList(
  projectId: string,
  enabled: boolean,
): { loading: boolean; error: string | null; reload: () => void } {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<{ key: string; error: string | null }>({ key: "", error: null });
  const key = `${projectId}|${attempt}`;

  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    let failed = false;
    const tick = () => {
      fetchJobs(api, projectId)
        .then((jobs) => {
          if (cancelled) return;
          failed = false;
          useJobsStore.getState().upsertMany(jobs);
          setStatus({ key, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          // Only the first failure of a run of failures is logged; polling must not spam the log.
          if (!failed) pushLog(`list jobs failed: ${messageOf(e, String(e))}`);
          failed = true;
          setStatus({ key, error: messageOf(e, "could not load jobs") });
        });
    };
    tick();
    const id = window.setInterval(tick, LIST_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, projectId, enabled, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const loaded = status.key === key;
  return { loading: enabled && !loaded, error: loaded ? status.error : null, reload };
}

/**
 * One `GET /jobs` when a project opens, so the active-job counter and the training screen's recent
 * jobs are right after a restart instead of staying empty until the jobs panel is opened.
 */
export function useInitialJobs(projectId: string): void {
  const api = useApi();
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchJobs(api, projectId)
      .then((jobs) => {
        if (!cancelled) useJobsStore.getState().upsertMany(jobs);
      })
      .catch((e: unknown) => {
        pushLog(`initial job list failed: ${messageOf(e, String(e))}`);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
}
