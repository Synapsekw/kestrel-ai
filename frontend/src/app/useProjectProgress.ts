import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useApi } from "@/api/client";
import { fetchDatasets } from "@/api/datasets";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { fetchModels, fetchProjectStats } from "@/api/project";
import { fetchQueryRuns } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useProgressStore } from "@/store/progress";
import type { ProjectProgress } from "./nextStep";
import { useProjectKindState } from "./useProjectKind";

/** The last known counts of a project; null until the shell has loaded them once. */
export function useProgress(projectId: string | undefined): ProjectProgress | null {
  return useProgressStore((s) => (projectId ? (s.byProject[projectId] ?? null) : null));
}

/**
 * Loads the counts behind the pipeline (sidebar, next-step banner, home) into the progress store.
 * Call it once, in the shell; everything else reads `useProgress`. Reloads on every screen change,
 * when a job ends and on `refresh()`. Box events are ignored on purpose: a detection run publishes
 * one per image. A failed load keeps the last value rather than blanking the sidebar. It waits for
 * the project's kind: a detection project has no datasets, and asking for them would be refused.
 */
export function useProjectProgress(projectId: string | undefined): {
  progress: ProjectProgress | null;
  refresh: () => void;
} {
  const api = useApi();
  const { pathname } = useLocation();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useOnJobsFinished("import", refresh);
  useOnJobsFinished("dataset", refresh);
  useOnJobsFinished("train", refresh);
  useOnJobsFinished("infer", refresh);
  useOnJobsFinished("map_import", refresh);
  const progress = useProgress(projectId);
  const { kind, failed } = useProjectKindState(projectId);
  const known = kind !== null || failed;

  useEffect(() => {
    if (!projectId || !known) return;
    let cancelled = false;
    Promise.all([
      fetchProjectStats(api, projectId),
      kind === "detect" ? Promise.resolve([]) : fetchDatasets(api, projectId),
      fetchModels(api, projectId),
      fetchQueryRuns(api, projectId),
      listMaps(api, projectId),
    ])
      .then(([stats, datasets, models, runs, maps]) => {
        if (cancelled) return;
        useProgressStore.getState().set(projectId, {
          images: stats.image_count,
          labeled: stats.labeled_count,
          pendingReview: stats.pending_review_count,
          datasets: datasets.length,
          models: models.length,
          trainedModels: models.filter((m) => m.kind === "trained").length,
          queryRuns: runs.length,
          maps: maps.length,
        });
      })
      .catch((e: unknown) => {
        pushLog(`project progress unavailable: ${messageOf(e, String(e))}`);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, kind, known, pathname, tick]);

  return { progress, refresh };
}
