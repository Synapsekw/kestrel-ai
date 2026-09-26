import type { Job } from "@contract/client";
import { RevealButton } from "@/exports/RevealButton";
import { JobCard } from "@/jobs/JobCard";
import { resultsExportFiles, resultsExportFolder, resultsExportSummary, stateLabel } from "@/jobs/jobLabels";
import { formatLocalDate } from "@/library/modelLabels";
import { isActiveJob } from "@/store/jobs";
import { Alert, EmptyState, Pill, SkeletonRows } from "@/ui";

interface Props {
  projectId: string;
  jobs: Job[];
  loading: boolean;
  error: string | null;
}

/** More than this many files: the row names the first ones and counts the rest, instead of a wall of text. */
const MAX_FILES_SHOWN = 8;

function ExportJobRow({ projectId, job }: { projectId: string; job: Job }) {
  const folder = resultsExportFolder(job);
  const files = resultsExportFiles(job);
  const summary = resultsExportSummary(job);
  const shown = files.slice(0, MAX_FILES_SHOWN);
  const hidden = files.length - shown.length;

  if (isActiveJob(job)) return <JobCard projectId={projectId} job={job} />;

  return (
    <li
      data-testid={`export-job-${job.id}`}
      className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-3.5 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill
          tone={job.state === "succeeded" ? "ok" : job.state === "failed" ? "danger" : "neutral"}
          size="sm"
        >
          {stateLabel(job.state)}
        </Pill>
        <span className="text-xs tabular-nums text-muted">{formatLocalDate(job.created_at)}</span>
        {summary && <span className="text-xs tabular-nums text-ink">{summary}</span>}
        {folder && (
          <span className="ml-auto">
            <RevealButton projectId={projectId} path={folder} />
          </span>
        )}
      </div>
      {job.error && <Alert tone="danger">{job.error}</Alert>}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-muted">
          {shown.map((f) => (
            <li key={f}>{f}</li>
          ))}
          {hidden > 0 && <li>and {hidden} more</li>}
        </ul>
      )}
    </li>
  );
}

export function ExportJobs({ projectId, jobs, loading, error }: Props) {
  if (loading) return <SkeletonRows rows={2} columns={3} />;
  // A partial failure (one export kind's request rejected, the other's resolved — see
  // `useResultsExportJobs`) must still show whatever DID load; only an error with nothing to show
  // replaces the list outright.
  if (error && jobs.length === 0) return <Alert tone="danger">{error}</Alert>;
  if (jobs.length === 0)
    return (
      <EmptyState icon="download" title="No exports yet">
        Pick what you need above and press Export. Every export writes into the project folder.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-2">
      {error && <Alert tone="danger">{error}</Alert>}
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <ExportJobRow key={job.id} projectId={projectId} job={job} />
        ))}
      </ul>
    </div>
  );
}
