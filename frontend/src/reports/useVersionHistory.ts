import { useCallback, useEffect, useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJob } from "@/api/jobs";
import { useReportVersions, type ReportVersion } from "@/api/reports";
import { pushLog } from "@/app/diagnostics";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { versionPages } from "./format";

export interface VersionHistory {
  reportId: string;
  items: ReportVersion[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  /** The render running for this report, if any: the tracked job or a `rendering` row's job. */
  running: Job | null;
  /** Follow a render the builder just started (or a 409 `render_running`'s `details.job_id`). */
  track: (jobId: string) => void;
  /** Pages of the newest ready version, for the preview's page count line (spec §12). */
  lastPages: number | null;
}

/** R6's paged versions (which reload when a `report_render` job ends) plus the running render's job. */
export function useVersionHistory(projectId: string, reportId: string): VersionHistory {
  const api = useApi();
  const list = useReportVersions(projectId, reportId);
  const [tracked, setTracked] = useState<string | null>(null);

  const renderingJobId = list.items.find((v) => v.state === "rendering" && v.job_id)?.job_id ?? null;
  const jobId = tracked ?? renderingJobId;
  const job = useJobsStore((s) => (jobId ? s.jobs[jobId] : undefined)) ?? null;
  const known = job !== null;

  // A rendering row whose job this session has not seen: read it once, so its events apply.
  useEffect(() => {
    if (!jobId || known) return;
    let cancelled = false;
    fetchJob(api, projectId, jobId).then(
      (j) => {
        if (!cancelled) useJobsStore.getState().upsert(j);
      },
      (e: unknown) => pushLog(`render job ${jobId} unavailable: ${messageOf(e, String(e))}`),
    );
    return () => {
      cancelled = true;
    };
  }, [api, projectId, jobId, known]);

  const { reload } = list;
  const track = useCallback(
    (id: string) => {
      setTracked(id);
      reload(); // R5 inserts a `rendering` row at once
    },
    [reload],
  );

  const ready = list.items.find((v) => v.state === "ready");
  return {
    reportId,
    items: list.items,
    loading: list.loading,
    error: list.error,
    hasMore: list.hasMore,
    loadMore: list.loadMore,
    reload,
    running: job && isActiveJob(job) ? job : null,
    track,
    lastPages: ready ? versionPages(ready) : null,
  };
}
