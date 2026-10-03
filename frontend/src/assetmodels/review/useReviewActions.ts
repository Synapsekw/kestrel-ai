// src/assetmodels/review/useReviewActions.ts
// The workspace's job buttons (spec §6): Estimate poses, Compute placements, Regroup. Each posts
// the job (202), puts it in the jobs store so the jobs dock and the end toast follow it, and says
// that it started. A job of the same kind already running for this model disables its button.
import { useCallback } from "react";
import type { Job } from "@contract/client";
import { computePlacements, estimatePoses, regroup as regroupFindings } from "@/api/assetReview";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { toast } from "@/ui";

export interface ReviewActions {
  running: { pose: boolean; place: boolean; group: boolean };
  estimate(): Promise<void>;
  compute(onlyDirty: boolean): Promise<void>;
  regroup(): Promise<void>;
}

const activeFor = (jobs: Record<string, Job>, type: Job["type"], modelId: string) =>
  Object.values(jobs).some((j) => j.type === type && isActiveJob(j) && j.params?.asset_model_id === modelId);

export function useReviewActions(projectId: string, modelId: string): ReviewActions {
  const api = useApi();
  const pose = useJobsStore((s) => activeFor(s.jobs, "asset_pose", modelId));
  const place = useJobsStore((s) => activeFor(s.jobs, "asset_place", modelId));
  const group = useJobsStore((s) => activeFor(s.jobs, "asset_group", modelId));
  const start = useCallback(async (run: () => Promise<Job>, started: string, failed: string) => {
    try {
      const job = await run();
      useJobsStore.getState().upsert(job);
      toast("info", started);
    } catch (e) {
      toast("danger", messageOf(e, failed));
    }
  }, []);
  return {
    running: { pose, place, group },
    estimate: () =>
      start(
        () => estimatePoses(api, projectId, modelId),
        "Estimating photo poses. You can keep working.",
        "The pose estimate could not start.",
      ),
    compute: (onlyDirty) =>
      start(
        () => computePlacements(api, projectId, modelId, onlyDirty),
        "Computing placements, then grouping the findings. You can keep working.",
        "The placements could not start.",
      ),
    regroup: () =>
      start(
        () => regroupFindings(api, projectId, modelId),
        "Regrouping the findings. You can keep working.",
        "Regroup could not start.",
      ),
  };
}
