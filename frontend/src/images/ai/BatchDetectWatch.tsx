import { useEffect, useRef } from "react";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { claimJobOutcome, jobToastText, toast } from "@/ui";
import { useBatchRuns } from "./BatchDetectDialog";

/** Mount once in the workspace: claims its runs' outcomes and offers "Review suggestions →" (§11.3). */
export function BatchDetectWatch({ onReview }: { onReview: () => void }) {
  const ids = useBatchRuns((s) => s.ids);
  const jobs = useJobsStore((s) => s.jobs);
  const releases = useRef(new Map<string, () => void>());
  const review = useRef(onReview);
  useEffect(() => {
    review.current = onReview;
  });

  useEffect(() => {
    for (const id of ids) if (!releases.current.has(id)) releases.current.set(id, claimJobOutcome(id));
    for (const id of ids) {
      const job = jobs[id];
      if (!job || isActiveJob(job)) continue;
      if (job.state === "succeeded") {
        const boxes = typeof job.result?.boxes === "number" ? (job.result.boxes as number) : null;
        toast("ok", boxes === null ? "Detection finished" : `Detection finished: ${boxes} suggestions`, {
          label: "Review suggestions →",
          onClick: () => review.current(),
        });
      } else toast(job.state === "failed" ? "danger" : "info", jobToastText(job));
      releases.current.get(id)?.();
      releases.current.delete(id);
      useBatchRuns.getState().drop(id);
    }
  }, [ids, jobs]);

  useEffect(
    () => () => {
      for (const release of releases.current.values()) release();
    },
    [],
  );
  return null;
}
