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

export function ExportScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const models = useModels(projectId);
  const { jobs, error: jobsError } = useResultsExportJobs(projectId);

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
      <h1 className="text-2xl font-semibold">Export</h1>
      {statsError && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {statsError}
        </p>
      )}
      <ExportForm
        projectId={projectId}
        labeledCount={stats?.labeled_count ?? null}
        boxCount={stats?.box_count ?? null}
      />
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Past exports</h2>
        {jobsError && (
          <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
            {jobsError}
          </p>
        )}
        <ExportJobs projectId={projectId} jobs={jobs} />
      </section>
      {!models.unavailable && <ModelExportSection projectId={projectId} models={models.models} />}
    </section>
  );
}
