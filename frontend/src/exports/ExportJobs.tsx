import type { Job } from "@contract/client";
import { RevealButton } from "@/exports/RevealButton";
import { JobCard } from "@/jobs/JobCard";
import { resultsExportFiles, resultsExportFolder, resultsExportSummary, stateLabel } from "@/jobs/jobLabels";
import { formatLocalDate } from "@/models/modelLabels";
import { isActiveJob } from "@/store/jobs";

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
      className="flex flex-col gap-1 rounded border border-slate-800 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-700 px-2 py-0.5 text-xs">{stateLabel(job.state)}</span>
        <span className="text-xs text-slate-400">{formatLocalDate(job.created_at)}</span>
        {summary && <span className="text-xs text-slate-300">{summary}</span>}
        {folder && (
          <span className="ml-auto">
            <RevealButton projectId={projectId} path={folder} />
          </span>
        )}
      </div>
      {job.error && (
        <p role="alert" className="text-xs text-red-300">
          {job.error}
        </p>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-slate-400">
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
  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (error) {
    return (
      <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
        {error}
      </p>
    );
  }
  if (jobs.length === 0) return <p className="text-sm text-slate-400">No exports yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {jobs.map((job) => (
        <ExportJobRow key={job.id} projectId={projectId} job={job} />
      ))}
    </ul>
  );
}
