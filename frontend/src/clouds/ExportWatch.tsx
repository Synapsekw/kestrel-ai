import { useEffect, useRef } from "react";
import { useApi } from "@/api/client";
import { revealInExplorer } from "@/api/exports";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob } from "@/store/jobs";
import { claimJobOutcome, toast } from "@/ui";

/**
 * Follows one LAZ export to its end and shows the finish toast, with "Show folder". While mounted it
 * claims the job's outcome, so the global job toast stays quiet for this job only; an export whose
 * watcher is not mounted (the Clouds screen was left) still gets the global toast. The screen mounts
 * it, not the Details tab, so switching tab or cloud mid-export cannot lose the outcome.
 */
export function ExportWatch({
  projectId,
  jobId,
  onDone,
}: {
  projectId: string;
  jobId: string;
  onDone(jobId: string): void;
}) {
  const api = useApi();
  const { job } = useTrackedJob(projectId, jobId);
  // A ref (not state) remembers the toast was shown, so a re-run of the effect never repeats it.
  const shown = useRef(false);

  useEffect(() => claimJobOutcome(jobId), [jobId]);

  useEffect(() => {
    if (!job || isActiveJob(job) || shown.current) return;
    shown.current = true;
    if (job.state === "succeeded") {
      const folder = String((job.result as Record<string, unknown> | null)?.folder ?? "exports");
      toast("ok", "LAZ export finished", {
        label: "Show folder",
        onClick: () => void revealInExplorer(api, projectId, folder).catch(() => undefined),
      });
    } else {
      toast("danger", `LAZ export ${job.state}: ${job.error ?? "see the log"}`);
    }
    onDone(job.id);
  }, [api, projectId, job, onDone]);

  return null;
}
