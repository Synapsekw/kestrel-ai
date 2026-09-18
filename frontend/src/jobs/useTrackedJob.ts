import { useEffect, useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { ApiFailure, codeOf, messageOf } from "@/api/errors";
import { fetchJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { isActiveJob, useJobsStore } from "@/store/jobs";

export const JOB_POLL_MS = 2000;
/** Consecutive failures tolerated before the poller gives up (a flaky sidecar gets a few retries). */
export const JOB_POLL_MAX_FAILURES = 5;

export interface TrackedJob {
  job: Job | null;
  /** Set once the poller gave up: the job is unknown, or it failed `JOB_POLL_MAX_FAILURES` times. */
  error: string | null;
}

/** A job the backend does not know is never going to appear: stop at once instead of polling forever. */
function isMissing(e: unknown): boolean {
  return codeOf(e) === "not_found" || (e instanceof ApiFailure && e.status === 404);
}

/**
 * The store's copy of one job, kept fresh by polling `GET /jobs/{id}` every 2 s while the job is
 * unknown or active. Websocket events update the same store entry, so both paths agree.
 * The poller stops on a 404 and after `JOB_POLL_MAX_FAILURES` consecutive failures, so a stale
 * `?job=` / `?run=` in the URL cannot spin forever; `error` then carries the reason.
 */
export function useTrackedJob(projectId: string, jobId: string | null): TrackedJob {
  const api = useApi();
  const job = useJobsStore((s) => (jobId ? (s.jobs[jobId] ?? null) : null));
  const [failure, setFailure] = useState<{ jobId: string; message: string } | null>(null);
  const polling = jobId !== null && (job === null || isActiveJob(job));

  useEffect(() => {
    if (!jobId || !polling) return;
    let cancelled = false;
    let failures = 0;
    let id = 0;
    const giveUp = (message: string) => {
      window.clearInterval(id);
      pushLog(`poll job ${jobId} gave up: ${message}`);
      setFailure({ jobId, message });
    };
    const tick = () => {
      fetchJob(api, projectId, jobId)
        .then((j) => {
          if (cancelled) return;
          failures = 0;
          useJobsStore.getState().upsert(j);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          failures += 1;
          const message = messageOf(e, `could not load job ${jobId}`);
          if (isMissing(e) || failures >= JOB_POLL_MAX_FAILURES) giveUp(message);
          // Only the first failure of a run is logged; giveUp logs the last one.
          else if (failures === 1) pushLog(`poll job ${jobId} failed: ${message}`);
        });
    };
    tick();
    id = window.setInterval(tick, JOB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, projectId, jobId, polling]);

  return { job, error: failure && failure.jobId === jobId ? failure.message : null };
}
