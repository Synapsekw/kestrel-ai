import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchLibraryJobs, isLibraryUnavailable, LIBRARY_JOBS } from "@/api/library";
import { pushLog } from "@/app/diagnostics";
import { isActiveJob, useJobsStore } from "@/store/jobs";

export const LIBRARY_POLL_MS = 2000;

export interface LibraryJobs {
  /** Library jobs in the store, newest first. */
  jobs: Job[];
  /** Follow a job this screen just started: it is shown at once and polling resumes. */
  track: (job: Job) => void;
  error: string | null;
}

/**
 * Library jobs (import, export, starter download): lists `/library/jobs` on mount and every 2 s while
 * any is queued or running, upserts them into the jobs store so the header's Jobs button counts them,
 * and calls `onFinished` once for each job it saw active that reached a terminal state.
 */
export function useLibraryJobs(
  onFinished?: (job: Job) => void,
  opts: { intervalMs?: number } = {},
): LibraryJobs {
  const api = useApi();
  const intervalMs = opts.intervalMs ?? LIBRARY_POLL_MS;
  const [nonce, setNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const seenActive = useRef(new Set<string>());
  const callback = useRef(onFinished);
  useEffect(() => {
    callback.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      fetchLibraryJobs(api)
        .then((jobs) => {
          if (cancelled) return;
          setError(null);
          useJobsStore.getState().upsertMany(jobs);
          let running = false;
          for (const job of jobs) {
            if (isActiveJob(job)) {
              running = true;
              seenActive.current.add(job.id);
            } else if (seenActive.current.delete(job.id)) {
              callback.current?.(job);
            }
          }
          // A tracked job the list has not caught up with yet keeps the poller alive.
          if (running || seenActive.current.size > 0) timer = setTimeout(poll, intervalMs);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          pushLog(`library jobs failed: ${messageOf(e, String(e))}`);
          if (isLibraryUnavailable(e)) return;
          setError(messageOf(e, "could not check the library jobs"));
          timer = setTimeout(poll, intervalMs);
        });
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, intervalMs, nonce]);

  const track = useCallback((job: Job) => {
    useJobsStore.getState().upsert(job);
    if (isActiveJob(job)) seenActive.current.add(job.id);
    setNonce((n) => n + 1);
  }, []);

  const all = useJobsStore((s) => s.jobs);
  const jobs = useMemo(
    () =>
      Object.values(all)
        .filter((j) => j.project_id === LIBRARY_JOBS)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [all],
  );
  return { jobs, track, error };
}
