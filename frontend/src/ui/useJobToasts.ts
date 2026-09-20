import { useEffect } from "react";
import type { Job } from "@contract/client";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { toast } from "./toastStore";

const TYPE_NAME: Record<Job["type"], string> = {
  import: "Import",
  dataset: "Dataset",
  train: "Training",
  infer: "Detection",
  export: "Export",
  results_export: "Results export",
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The one-line toast for a job that just ended. */
export function jobToastText(job: Job): string {
  const r = (job.result ?? {}) as Record<string, unknown>;
  if (job.state === "failed")
    return `${TYPE_NAME[job.type]} failed: ${job.error ?? job.message ?? "see the log"}`;
  if (job.state === "cancelled") return `${TYPE_NAME[job.type]} cancelled`;
  switch (job.type) {
    case "import": {
      const imported = num(r.imported);
      const duplicates = num(r.duplicates) ?? 0;
      const failed = num(r.failed) ?? 0;
      if (imported === null) return "Import finished";
      const extra = [duplicates > 0 && `${duplicates} duplicates skipped`, failed > 0 && `${failed} failed`]
        .filter(Boolean)
        .join(", ");
      return `Import finished: ${imported} ${imported === 1 ? "image" : "images"}${extra ? ` (${extra})` : ""}`;
    }
    case "train":
      return "Training finished: the model is registered";
    case "infer": {
      const boxes = num(r.boxes);
      return boxes === null
        ? "Detection finished"
        : `Detection finished: ${boxes} ${boxes === 1 ? "box" : "boxes"} found`;
    }
    case "dataset":
      return "Dataset ready";
    case "export":
      return "Export finished";
    case "results_export":
      return "Results export finished";
  }
}

/** Stable default: a new object per render would resubscribe the hook and forget running jobs. */
const NO_PATH = { current: "" };

/** The screen (route segment) that already reports each job type's outcome inline. */
const REPORTED_ON: Partial<Record<Job["type"], string>> = {
  import: "data",
  dataset: "data",
  train: "train",
  infer: "query",
};

/** True when the screen at `pathname` shows this job's outcome itself, so a toast would repeat it. */
export function reportedInline(job: Job, pathname: string): boolean {
  const segment = REPORTED_ON[job.type];
  return !!segment && pathname.replace(/\/$/, "").endsWith(`/p/${job.project_id}/${segment}`);
}

/**
 * Shows a toast when a job of this project that was seen running reaches a terminal state, unless
 * the current screen already reports it (`pathnameRef` is read at the moment the job ends).
 * Failures carry a "Show log" action that opens the jobs drawer.
 */
export function useJobToasts(
  projectId: string | undefined,
  pathnameRef: { current: string } = NO_PATH,
): void {
  useEffect(() => {
    if (!projectId) return;
    const active = new Set<string>();
    const scan = (jobs: Record<string, Job>) => {
      for (const job of Object.values(jobs)) {
        if (job.project_id !== projectId) continue;
        if (isActiveJob(job)) {
          active.add(job.id);
          continue;
        }
        if (!active.delete(job.id)) continue;
        if (reportedInline(job, pathnameRef.current)) continue;
        if (job.state === "failed") {
          toast("danger", jobToastText(job), {
            label: "Show log",
            onClick: () => useJobsStore.getState().setPanelOpen(true),
          });
        } else if (job.state === "cancelled") {
          toast("info", jobToastText(job));
        } else {
          toast("ok", jobToastText(job));
        }
      }
    };
    scan(useJobsStore.getState().jobs);
    return useJobsStore.subscribe((s) => scan(s.jobs));
  }, [projectId, pathnameRef]);
}
