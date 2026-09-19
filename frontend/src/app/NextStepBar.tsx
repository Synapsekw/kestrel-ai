import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useApi } from "@/api/client";
import { fetchDatasets } from "@/api/datasets";
import { messageOf } from "@/api/errors";
import { fetchModels, fetchProjectStats } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { nextStep, type ProjectProgress } from "./nextStep";

/** A slim "Next: ..." line for the open project; silent when the numbers cannot be loaded. */
export function NextStepBar({ projectId }: { projectId: string }) {
  const api = useApi();
  const { pathname } = useLocation();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useOnJobsFinished("import", refresh);
  useOnJobsFinished("dataset", refresh);
  useOnJobsFinished("train", refresh);
  useOnJobsFinished("infer", refresh);
  const [progress, setProgress] = useState<{ projectId: string; value: ProjectProgress } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchProjectStats(api, projectId),
      fetchDatasets(api, projectId),
      fetchModels(api, projectId),
    ])
      .then(([stats, datasets, models]) => {
        if (cancelled) return;
        setProgress({
          projectId,
          value: {
            images: stats.image_count,
            labeled: stats.labeled_count,
            pendingReview: stats.pending_review_count,
            datasets: datasets.length,
            models: models.length,
            trainedModels: models.filter((m) => m.kind === "trained").length,
          },
        });
      })
      .catch((e: unknown) => {
        pushLog(`next step unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setProgress(null);
      });
    return () => {
      cancelled = true;
    };
    // The screen changed or a job ended: the numbers may have moved. Box events are ignored on
    // purpose; a detection run publishes one per image.
  }, [api, projectId, pathname, tick]);

  const step = progress && progress.projectId === projectId ? nextStep(projectId, progress.value) : null;
  if (!step) return null;
  return (
    <p
      data-testid="next-step"
      className="border-b border-slate-800 bg-slate-900/60 px-6 py-1.5 text-xs text-slate-400"
    >
      Next:{" "}
      <Link to={step.to} className="text-orange-300 hover:underline">
        {step.text}
      </Link>
    </p>
  );
}
