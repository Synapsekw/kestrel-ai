import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Stats } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchProjectStats } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { ExportForm } from "@/exports/ExportForm";
import { ExportJobs } from "@/exports/ExportJobs";
import { ModelExportSection } from "@/exports/ModelExportSection";
import { useResultsExportJobs } from "@/exports/useResultsExportJobs";
import { useModels } from "@/models/useModels";
import { Alert } from "@/ui";

export function ExportScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const models = useModels(projectId);
  const { jobs, loading: jobsLoading, error: jobsError } = useResultsExportJobs(projectId);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchProjectStats(api, projectId)
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load project stats failed: ${messageOf(e, String(e))}`);
        setStatsError(messageOf(e, "could not load project stats"));
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Export</h1>
        <p className="text-sm text-muted">
          Take the counts, the labels and the trained model out of the app. Everything is written into the
          project folder.
        </p>
      </div>
      {statsError && <Alert tone="danger">{statsError}</Alert>}
      <ExportForm
        projectId={projectId}
        labeledCount={stats?.labeled_count ?? null}
        boxCount={stats?.box_count ?? null}
        imageCount={stats?.image_count ?? null}
        pendingReviewCount={stats?.pending_review_count ?? null}
      />
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Past exports</h2>
        <ExportJobs projectId={projectId} jobs={jobs} loading={jobsLoading} error={jobsError} />
      </section>
      {!models.unavailable && <ModelExportSection projectId={projectId} models={models.models} />}
    </section>
  );
}
