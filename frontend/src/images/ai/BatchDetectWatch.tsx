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
        const found = boxes === null ? "" : `: ${boxes} ${boxes === 1 ? "suggestion" : "suggestions"}`;
        toast("ok", `Detection finished${found}`, {
          label: "Review suggestions →",
          onClick: () => review.current(),
        });
      } else toast(job.state === "failed" ? "danger" : "info", jobToastText(job));
      releases.current.get(id)?.();
      releases.current.delete(id);
      useBatchRuns.getState().drop(id);
    }
  }, [ids, jobs]);

  // Unmounting hands every tracked run back to the global job toast (its claim is released), so it
  // is dropped here too: a remount must not report an outcome the global toast already did (M5).
  useEffect(
    () => () => {
      for (const release of releases.current.values()) release();
      releases.current.clear();
      useBatchRuns.setState({ ids: [] });
    },
    [],
  );
  return null;
}
