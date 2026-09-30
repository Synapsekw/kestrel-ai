import { useCallback, useEffect, useMemo, useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJobs } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";

const EXPORT_TYPES = new Set<Job["type"]>([
  "results_export",
  "map_export",
  "detect_export",
  "volume_export",
  "pointcloud_export",
]);

/** This project's file-producing exports, newest first across every kind: `results_export` and
 * `detect_export` from Data exports, `map_export` from the Map workspace, `volume_export` from the
 * volume view, `pointcloud_export` from Point clouds (reports spec §13). Report renders are not
 * listed; they live in report history. Kept fresh by the websocket through the jobs store too. */
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
    // The list endpoint's `type` filter takes one value, so each export type needs its own request;
    // all land in the same job store and are merged by `selectExportJobs`.
    // `allSettled`, not `all`: one kind failing must not hide the other kind's jobs that DID load.
    const kinds = [
      { type: "results_export" as const, label: "results exports" },
      { type: "map_export" as const, label: "map exports" },
      { type: "detect_export" as const, label: "detection exports" },
      { type: "volume_export" as const, label: "volume exports" },
      { type: "pointcloud_export" as const, label: "point cloud exports" },
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
