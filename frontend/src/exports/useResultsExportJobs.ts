import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJobs } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";

const EXPORT_TYPES = new Set<Job["type"]>(["results_export", "map_export", "detect_export"]);

/** This project's file-producing exports (a `results_export` or a `detect_export` from the Export
 * screen, or a `map_export` from the Maps screen), newest first across every kind; kept fresh by
 * the jobs panel's websocket too. */
function selectExportJobs(jobs: Record<string, Job>, projectId: string): Job[] {
  return Object.values(jobs)
    .filter((j) => EXPORT_TYPES.has(j.type) && j.project_id === projectId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function useResultsExportJobs(projectId: string): {
  jobs: Job[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = `${projectId}|${attempt}`;
  const [status, setStatus] = useState<{ key: string; error: string | null }>({ key: "", error: null });
  const stored = useJobsStore((s) => s.jobs);
  const jobs = useMemo(() => selectExportJobs(stored, projectId), [stored, projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    // The list endpoint's `type` filter takes one value, so a map export (a different job type)
    // needs its own request; both land in the same job store and are merged by `selectExportJobs`.
    // `allSettled`, not `all`: one kind failing must not hide the other kind's jobs that DID load.
    const kinds = [
      { type: "results_export" as const, label: "results exports" },
      { type: "map_export" as const, label: "map exports" },
      { type: "detect_export" as const, label: "detection exports" },
    ];
    Promise.allSettled(kinds.map((k) => fetchJobs(api, projectId, { type: k.type }))).then((results) => {
      if (cancelled) return;
      const loaded: Job[] = [];
      const failedLabels: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          loaded.push(...r.value);
        } else {
          failedLabels.push(kinds[i].label);
          pushLog(`load past ${kinds[i].label} failed: ${messageOf(r.reason, String(r.reason))}`);
        }
      });
      if (loaded.length > 0) useJobsStore.getState().upsertMany(loaded);
      const error = failedLabels.length > 0 ? `could not load past ${failedLabels.join(" or ")}` : null;
      setStatus({ key, error });
    });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const loaded = status.key === key;
  return { jobs, loading: !loaded, error: loaded ? status.error : null, reload };
}
