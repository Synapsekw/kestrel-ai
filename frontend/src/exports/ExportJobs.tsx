import { useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { revealInExplorer } from "@/api/exports";
import { pushLog } from "@/app/diagnostics";
import { JobCard } from "@/jobs/JobCard";
import { resultsExportFiles, resultsExportFolder, resultsExportSummary, stateLabel } from "@/jobs/jobLabels";
import { formatLocalDate } from "@/models/modelLabels";
import { isActiveJob } from "@/store/jobs";

interface Props {
  projectId: string;
  jobs: Job[];
}

const btn = "rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-50";

function ExportJobRow({ projectId, job }: { projectId: string; job: Job }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const folder = resultsExportFolder(job);
  const files = resultsExportFiles(job);
  const summary = resultsExportSummary(job);

  async function show() {
    if (!folder) return;
    setBusy(true);
    setError(null);
    try {
      await revealInExplorer(api, projectId, folder);
    } catch (e) {
      pushLog(`reveal ${folder} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not open Explorer"));
    } finally {
      setBusy(false);
    }
  }

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
          <button type="button" className={`${btn} ml-auto`} disabled={busy} onClick={() => void show()}>
            Show in folder
          </button>
        )}
      </div>
      {job.error && (
        <p role="alert" className="text-xs text-red-300">
          {job.error}
        </p>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs text-slate-400">
          {files.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </li>
  );
}

export function ExportJobs({ projectId, jobs }: Props) {
  if (jobs.length === 0) return <p className="text-sm text-slate-400">No exports yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {jobs.map((job) => (
        <ExportJobRow key={job.id} projectId={projectId} job={job} />
      ))}
    </ul>
  );
}
