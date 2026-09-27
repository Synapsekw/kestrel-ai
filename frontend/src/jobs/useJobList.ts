import { useEffect } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJobs } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";

/**
 * One `GET /jobs` when a project opens, so the active-job counter and the training screen's recent
 * jobs are right after a restart instead of staying empty until the Jobs section is opened.
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
