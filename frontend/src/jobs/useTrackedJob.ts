import { useCallback, useEffect, useState } from "react";
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
  /** Re-arms the poller after it gave up (the "Retry" button of the alert). */
  retry: () => void;
}

/** A job the backend does not know is never going to appear: stop at once instead of polling forever. */
function isMissing(e: unknown): boolean {
  return codeOf(e) === "not_found" || (e instanceof ApiFailure && e.status === 404);
}

/**
 * The store's copy of one job, kept fresh by polling `GET /jobs/{id}` every 2 s while the job is
 * unknown or active. Websocket events update the same store entry, so both paths agree.
 *
 * The poller stops on a 404 and after `JOB_POLL_MAX_FAILURES` consecutive failures, so a stale
 * `?job=` / `?run=` in the URL cannot spin forever; `error` then carries the reason. Giving up is
 * not final: anything that reaches the store for this id (a websocket event, the jobs panel, another
 * tracker) proves the backend is back, so the poller re-arms and the error clears; `retry()` does
 * the same on demand.
 */
export function useTrackedJob(projectId: string, jobId: string | null): TrackedJob {
  const api = useApi();
  const job = useJobsStore((s) => (jobId ? (s.jobs[jobId] ?? null) : null));
  const [failure, setFailure] = useState<{ jobId: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let gaveUp = false;
    let failures = 0;
    let id = 0;

    const clearFailure = () => setFailure((f) => (f && f.jobId === jobId ? null : f));

    const stop = () => {
      window.clearInterval(id);
      id = 0;
    };

    const giveUp = (message: string) => {
      // Guards a second in-flight request from giving up (and logging) twice.
      if (gaveUp) return;
      gaveUp = true;
      stop();
      pushLog(`poll job ${jobId} gave up: ${message}`);
      setFailure({ jobId, message });
    };

    const tick = () => {
      fetchJob(api, projectId, jobId)
        .then((j) => {
          if (cancelled) return;
          failures = 0;
          clearFailure();
          useJobsStore.getState().upsert(j);
          if (!isActiveJob(j)) stop();
        })
        .catch((e: unknown) => {
          if (cancelled || gaveUp) return;
          failures += 1;
          const message = messageOf(e, `could not load job ${jobId}`);
          if (isMissing(e) || failures >= JOB_POLL_MAX_FAILURES) giveUp(message);
          // Only the first failure of a run is logged; giveUp logs the last one.
          else if (failures === 1) pushLog(`poll job ${jobId} failed: ${message}`);
        });
    };

    const start = () => {
      if (cancelled || id !== 0) return;
      const known = useJobsStore.getState().jobs[jobId];
      // A finished job never changes again; there is nothing to poll for.
      if (known && !isActiveJob(known)) return;
      gaveUp = false;
      failures = 0;
      tick();
      id = window.setInterval(tick, JOB_POLL_MS);
    };

    // Anything arriving for this id means the backend answered someone: drop the error and resume.
    const unsubscribe = useJobsStore.subscribe((s, prev) => {
      if (cancelled || s.jobs[jobId] === prev.jobs[jobId]) return;
      clearFailure();
      start();
    });

    start();
    return () => {
      cancelled = true;
      unsubscribe();
      stop();
    };
  }, [api, projectId, jobId, attempt]);

  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((a) => a + 1);
  }, []);

  return { job, error: failure && failure.jobId === jobId ? failure.message : null, retry };
}
