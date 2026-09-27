import { useCallback, useEffect, useState } from "react";
import type { Job } from "@contract/client";
import { ExportWatch } from "@/clouds/ExportWatch";
import { isActiveJob, useJobsStore } from "@/store/jobs";

/** This project's running LAZ exports in the jobs store, job id -> cloud id. */
function runningExports(jobs: Record<string, Job>, projectId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const j of Object.values(jobs)) {
    const cloudId = (j.params as Record<string, unknown> | null)?.cloud_id;
    if (
      j.type === "pointcloud_export" &&
      j.project_id === projectId &&
      isActiveJob(j) &&
      typeof cloudId === "string"
    )
      out[j.id] = cloudId;
  }
  return out;
}

/**
 * Followed LAZ exports (S1): held by the always-mounted workspace so closing the Details dialog or
 * switching clouds mid-export still ends in its toast, and seeded from the jobs store (which
 * outlives the screen) so leaving and coming back does too.
 */
export function useCloudExports(projectId: string) {
  const [exports, setExports] = useState<Record<string, string>>(() =>
    runningExports(useJobsStore.getState().jobs, projectId),
  );
  useEffect(
    () =>
      useJobsStore.subscribe((s) => {
        const running = runningExports(s.jobs, projectId);
        setExports((e) => {
          const missing = Object.entries(running).filter(([id]) => !(id in e));
          return missing.length ? { ...e, ...Object.fromEntries(missing) } : e;
        });
      }),
    [projectId],
  );
  const done = useCallback(
    (jobId: string) =>
      setExports((e) => Object.fromEntries(Object.entries(e).filter(([id]) => id !== jobId))),
    [],
  );
  const started = useCallback(
    (jobId: string, cloudId: string) => setExports((e) => ({ ...e, [jobId]: cloudId })),
    [],
  );
  const exportFor = (cloudId: string) => Object.entries(exports).find(([, c]) => c === cloudId)?.[0] ?? null;
  const watchers = Object.keys(exports).map((jobId) => (
    <ExportWatch key={jobId} projectId={projectId} jobId={jobId} onDone={done} />
  ));
  return { exportFor, started, watchers };
}
