import { useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelJob } from "@/api/jobs";
import { fetchLibraryStatus, isLibraryUnavailable, LIBRARY_JOBS } from "@/api/library";
import { pushLog } from "@/app/diagnostics";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";
import { claimJobOutcome } from "@/ui";
import { inspectResultOf, startInspect } from "./api";
import { useSetupDraft } from "./draftStore";
import { MAX_DROP_PATHS } from "./model";

export interface InspectControl {
  /** The running or last-seen sort job, live from the jobs store. */
  job: Job | null;
  running: boolean;
  /** Why the last sort did not start or did not finish; null when it did. */
  error: string | null;
  /** The poller gave up (the backend stopped answering); `retryPoll` re-arms it. */
  pollError: string | null;
  retryPoll: () => void;
  /** S-R3: why sorting is unavailable, or null while the library is open. */
  libraryUnavailable: string | null;
  /** How many paths the running sort was given when more than 16 came in (only the first 16 are sorted); else null. */
  overflow: number | null;
  /** Sorts `paths` (at most 16); `slotKey` is the slot whose Browse started it. */
  start: (paths: string[], slotKey?: string | null) => Promise<void>;
  cancel: () => Promise<void>;
  dismissError: () => void;
}

/**
 * The `setup_inspect` job of the Data card. The job id lives in the draft, so leaving the page mid-sort
 * and coming back resumes following it; the result is applied once (`applyInspect` checks the id).
 */
export function useInspect(): InspectControl {
  const api = useApi();
  const run = useSetupDraft((s) => s.inspect);
  const inspectError = useSetupDraft((s) => s.inspectError);
  const templateId = useSetupDraft((s) => s.templateId);
  const [library, setLibrary] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [overflow, setOverflow] = useState<{ jobId: string; total: number } | null>(null);
  // Set before the start request goes out, so a second quick start does not send another (the draft's
  // `inspect` is only set when the request returns).
  const starting = useRef(false);
  const jobId = run?.jobId ?? null;
  const tracked = useTrackedJob(LIBRARY_JOBS, jobId);
  const job = tracked.job;

  useEffect(() => {
    let cancelled = false;
    fetchLibraryStatus(api)
      .then((s) => {
        if (!cancelled && !s.available) setLibrary(s.error ?? "the model library could not be opened");
      })
      .catch((e: unknown) => pushLog(`library status unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api]);

  // While the card shows this sort, it reports the outcome itself; the global toast stays quiet (Ruling 13).
  useEffect(() => (jobId ? claimJobOutcome(jobId) : undefined), [jobId]);

  useEffect(() => {
    if (!job || job.id !== jobId) return;
    const draft = useSetupDraft.getState();
    if (job.state === "succeeded") {
      const result = inspectResultOf(job);
      if (result) draft.applyInspect(job.id, result);
      else draft.failInspect(job.id, "The sort finished without a result. Drop the folder again.");
    } else if (job.state === "failed") {
      draft.failInspect(job.id, job.error ?? "Sorting the files failed. Drop the folder again.");
    } else if (job.state === "cancelled") {
      draft.clearInspect();
    }
  }, [job, jobId]);

  const start = useCallback(
    async (paths: string[], slotKey: string | null = null) => {
      const given = paths.map((p) => p.trim()).filter(Boolean);
      const clean = given.slice(0, MAX_DROP_PATHS);
      if (clean.length === 0 || starting.current || useSetupDraft.getState().inspect) return;
      starting.current = true;
      setStartError(null);
      setOverflow(null);
      try {
        const started = await startInspect(api, {
          paths: clean,
          ...(templateId ? { template_id: templateId } : {}),
        });
        useJobsStore.getState().upsert(started);
        useSetupDraft.getState().beginInspect({ jobId: started.id, slotKey, paths: clean });
        if (given.length > clean.length) setOverflow({ jobId: started.id, total: given.length });
      } catch (e) {
        if (isLibraryUnavailable(e)) setLibrary(messageOf(e, "the model library could not be opened"));
        else setStartError(messageOf(e, "could not start sorting the files"));
      } finally {
        starting.current = false;
      }
    },
    [api, templateId],
  );

  const cancel = useCallback(async () => {
    const current = useSetupDraft.getState().inspect;
    if (!current) return;
    try {
      await cancelJob(api, LIBRARY_JOBS, current.jobId);
    } catch (e) {
      pushLog(`cancel sort ${current.jobId} failed: ${messageOf(e, String(e))}`);
    }
    useSetupDraft.getState().clearInspect();
  }, [api]);

  const dismissError = useCallback(() => {
    setStartError(null);
    useSetupDraft.getState().dismissInspectError();
  }, []);

  return {
    job,
    running: run !== null,
    error: startError ?? inspectError,
    pollError: tracked.error,
    retryPoll: tracked.retry,
    libraryUnavailable: library,
    overflow: overflow && overflow.jobId === jobId ? overflow.total : null,
    start,
    cancel,
    dismissError,
  };
}
