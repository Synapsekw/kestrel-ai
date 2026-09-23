import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Stats } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchProjectStats } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { useProjectKind } from "@/app/useProjectKind";
import { DetectExportForm } from "@/exports/DetectExportForm";
import { ExportForm } from "@/exports/ExportForm";
import { ExportJobs } from "@/exports/ExportJobs";
import { useResultsExportJobs } from "@/exports/useResultsExportJobs";
import { Alert, buttonClass } from "@/ui";

export function ExportScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const kind = useProjectKind(projectId);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
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
          Take the counts and the labels out of the app. Everything is written into the project folder.
        </p>
      </div>
      {statsError && <Alert tone="danger">{statsError}</Alert>}
      {kind === "detect" && (
        <>
          <DetectExportForm projectId={projectId} />
          <p className="max-w-prose text-sm text-muted">
            A map&apos;s detections with their coordinates export from the map viewer as GeoPackage, GeoJSON
            or CSV; the GeoPackage also carries the review state and the site areas.
          </p>
        </>
      )}
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
      {kind === "train" && (
        <section aria-label="Model for other applications" className="flex max-w-3xl flex-col gap-2">
          <h2 className="text-base font-semibold">Model for other applications</h2>
          <p className="text-sm text-muted">
            Models live in the library, shared by every project. Open a model there to export it as ONNX or
            TensorRT.
          </p>
          <Link to="/library" className={buttonClass("secondary", "md", "w-fit")}>
            Open the library
          </Link>
        </section>
      )}
    </section>
  );
}
