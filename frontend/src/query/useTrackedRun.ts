import { useCallback, useEffect, useState } from "react";
import type { Job, QueryRun } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchQueryRun } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";
import { JOB_POLL_MS, useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob } from "@/store/jobs";

interface State {
  runId: string | null;
  run: QueryRun | null;
  error: string | null;
}

export interface TrackedRun {
  run: QueryRun | null;
  job: Job | null;
  /** A failed run fetch, or the reason the job poller gave up; the loaded run stays rendered. */
  error: string | null;
  replace: (run: QueryRun) => void;
  /** Follow a new job for this run (after a resume) without waiting for the next run poll. */
  trackJob: (job: Job) => void;
}

/** The run (box_count grows while the job writes tiles) and its job; both polled while the job is active. */
export function useTrackedRun(projectId: string, runId: string | null): TrackedRun {
  const api = useApi();
  const [state, setState] = useState<State>({ runId: null, run: null, error: null });
  const run = state.runId === runId ? state.run : null;
  const { job, error: jobError } = useTrackedJob(projectId, run?.job_id ?? null);
  const live = job !== null && isActiveJob(job);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let failed = false;
    const tick = () => {
      fetchQueryRun(api, projectId, runId)
        .then((r) => {
          if (cancelled) return;
          failed = false;
          setState({ runId, run: r, error: null });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          // Only the first failure of a run of failures is logged; polling every 2 s must not spam.
          if (!failed) pushLog(`load query run ${runId} failed: ${messageOf(e, String(e))}`);
          failed = true;
          setState((s) => ({
            runId,
            run: s.runId === runId ? s.run : null,
            error: messageOf(e, "could not load the run"),
          }));
        });
    };
    tick();
    if (!live) {
      return () => {
        cancelled = true;
      };
    }
    const id = window.setInterval(tick, JOB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [api, projectId, runId, live]);

  const replace = useCallback((r: QueryRun) => setState({ runId: r.id, run: r, error: null }), []);
  const trackJob = useCallback(
    (j: Job) => setState((s) => (s.run ? { ...s, run: { ...s.run, job_id: j.id } } : s)),
    [],
  );
  const runError = state.runId === runId ? state.error : null;
  return { run, job, error: runError ?? jobError, replace, trackJob };
}
