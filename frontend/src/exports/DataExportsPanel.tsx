import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Stats } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchProjectStats } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { DetectExportForm } from "@/exports/DetectExportForm";
import { ExportForm } from "@/exports/ExportForm";
import { ExportJobs } from "@/exports/ExportJobs";
import { useResultsExportJobs } from "@/exports/useResultsExportJobs";
import { Alert, buttonClass } from "@/ui";

/** Exports that stay in their workspace (reports spec §13), listed here with a link. */
const ELSEWHERE: { key: string; text: string; link: string; path: string }[] = [
  {
    key: "maps",
    text: "A map's detections, drawings and site areas export from the Map workspace as GeoPackage, GeoJSON or CSV.",
    link: "Open the Map workspace",
    path: "maps",
  },
  {
    key: "clouds",
    text: "A point cloud exports from Point clouds as LAZ, with its measurements.",
    link: "Open Point clouds",
    path: "clouds",
  },
  {
    key: "volumes",
    text: "Volumes export from the volume view as a technical bundle: PDF, GeoPackage, GeoTIFF, CSV and Excel.",
    link: "Open surfaces and volumes",
    path: "measurements/volumes",
  },
];

/**
 * Reports → Data exports (reports spec §13): the data-shaped exports, which used to be the Export
 * screen. No page heading or padding: the host (the Reports tab) owns the page.
 */
export function DataExportsPanel({ projectId }: { projectId: string }) {
  const api = useApi();
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
    <section aria-label="Data exports" className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-muted">
        The data itself, for Excel, GIS and labelling tools. Everything is written into the project folder.
      </p>
      {statsError && <Alert tone="danger">{statsError}</Alert>}
      <DetectExportForm projectId={projectId} />
      <ExportForm
        projectId={projectId}
        labeledCount={stats?.labeled_count ?? null}
        boxCount={stats?.box_count ?? null}
        imageCount={stats?.image_count ?? null}
        pendingReviewCount={stats?.pending_review_count ?? null}
      />
      <section
        aria-label="Exports in their workspaces"
        className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-5"
      >
        <h2 className="text-base font-semibold">Exports in their workspaces</h2>
        <ul className="flex flex-col gap-3">
          {ELSEWHERE.map((e) => (
            <li key={e.key} className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-prose text-sm text-muted">{e.text}</p>
              <Link to={`/p/${projectId}/${e.path}`} className={buttonClass("secondary", "sm", "w-fit")}>
                {e.link}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Past exports</h2>
        <ExportJobs projectId={projectId} jobs={jobs} loading={jobsLoading} error={jobsError} />
      </section>
    </section>
  );
}
