import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { JobCard } from "@/jobs/JobCard";
import { useJobList } from "@/jobs/useJobList";
import { useJobsStore } from "@/store/jobs";
import { Alert, EmptyState, IconButton, SkeletonRows } from "@/ui";

/** `/jobs?project=` until the app-wide Jobs section lands: the project's jobs, newest first. */
export function InterimJobs() {
  const [params] = useSearchParams();
  const projectId = params.get("project") ?? "";
  const jobs = useJobsStore((s) => s.jobs);
  const list = useJobList(projectId, projectId !== "");
  const sorted = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.project_id === projectId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [jobs, projectId],
  );
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-xl font-semibold">Jobs</h1>
        {projectId && (
          <IconButton icon="refresh" label="Refresh" onClick={list.reload} disabled={list.loading} />
        )}
      </div>
      {!projectId ? (
        <EmptyState icon="jobs" title="Open a project to see its jobs">
          Imports, detections, exports and training runs are listed here while they run and after they finish.
        </EmptyState>
      ) : (
        <>
          {list.error && <Alert tone="danger">{list.error}</Alert>}
          {sorted.length === 0 &&
            (list.loading ? (
              <SkeletonRows rows={3} columns={3} />
            ) : (
              <p className="py-6 text-sm text-muted">No jobs yet.</p>
            ))}
          {sorted.length > 0 && (
            <ul className="flex flex-col divide-y divide-line">
              {sorted.map((job) => (
                <li key={job.id}>
                  <JobCard projectId={projectId} job={job} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
