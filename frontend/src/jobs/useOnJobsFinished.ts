import { useEffect, useRef } from "react";
import type { Job } from "@contract/client";
import { isActiveJob, useJobsStore } from "@/store/jobs";

/** Calls `onFinished` when a job of `type` that this hook saw active reaches a terminal state. */
export function useOnJobsFinished(type: Job["type"], onFinished: () => void): void {
  const callback = useRef(onFinished);
  useEffect(() => {
    callback.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    const active = new Set<string>();
    const scan = (jobs: Record<string, Job>) => {
      let finished = false;
      for (const job of Object.values(jobs)) {
        if (job.type !== type) continue;
        if (isActiveJob(job)) active.add(job.id);
        else if (active.delete(job.id)) finished = true;
      }
      if (finished) callback.current();
    };
    scan(useJobsStore.getState().jobs);
    return useJobsStore.subscribe((s) => scan(s.jobs));
  }, [type]);
}
