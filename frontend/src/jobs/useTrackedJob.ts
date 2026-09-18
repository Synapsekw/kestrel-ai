import { useEffect } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { isActiveJob, useJobsStore } from "@/store/jobs";

export const JOB_POLL_MS = 2000;

/**
 * The store's copy of one job, kept fresh by polling `GET /jobs/{id}` every 2 s while the job is
 * unknown or active. Websocket events update the same store entry, so both paths agree.
 */
export function useTrackedJob(projectId: string, jobId: string | null): Job | null {
  const api = useApi();
  const job = useJobsStore((s) => (jobId ? (s.jobs[jobId] ?? null) : null));
  const polling = jobId !== null && (job === null || isActiveJob(job));

  useEffect(() => {
    if (!jobId || !polling) return;
    let cancelled = false;
    const tick = () => {
      fetchJob(api, projectId, jobId)
        .then((j) => {
          if (!cancelled) useJobsStore.getState().upsert(j);
        })
        .catch((e: unknown) => {
          pushLog(`poll job ${jobId} failed: ${messageOf(e, String(e))}`);
        });
    };
    tick();
    const id = window.setInterval(tick, JOB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, projectId, jobId, polling]);

  return job;
}
