import { useState } from "react";
import { Link } from "react-router-dom";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { elapsedSeconds, formatDuration, jobTitle, resultTarget, stateLabel } from "./jobLabels";
import { JobLogView } from "./JobLogView";
import { useNow } from "./useNow";

interface Props {
  projectId: string;
  job: Job;
  /** Start with the log open (the training screen). */
  showLog?: boolean;
}

const STATE_CLASS: Record<Job["state"], string> = {
  queued: "bg-slate-700 text-slate-200",
  running: "bg-orange-700 text-orange-100",
  succeeded: "bg-emerald-800 text-emerald-100",
  failed: "bg-red-800 text-red-100",
  cancelled: "bg-slate-600 text-slate-200",
};

const btn = "rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-50";

export function JobCard({ projectId, job, showLog = false }: Props) {
  const api = useApi();
  const active = isActiveJob(job);
  const now = useNow(1000, active);
  const [logOpen, setLogOpen] = useState(showLog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = elapsedSeconds(job, now);
  const target = resultTarget(job, projectId);
  const percent = Math.round(job.progress * 100);
  const title = jobTitle(job);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      useJobsStore.getState().upsert(await cancelJob(api, projectId, job.id));
    } catch (e) {
      pushLog(`cancel job ${job.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not cancel the job"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      data-testid={`job-${job.id}`}
      className="flex flex-col gap-2 rounded border border-slate-700 bg-slate-800/60 p-3 text-sm"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{title}</span>
        <span data-testid="jobcard-state" className={`rounded px-2 py-0.5 text-xs ${STATE_CLASS[job.state]}`}>
          {stateLabel(job.state)}
        </span>
        {elapsed !== null && <span className="text-xs text-slate-400">{formatDuration(elapsed)}</span>}
        <span className="ml-auto font-mono text-xs text-slate-500">{job.id.slice(0, 8)}</span>
      </header>
      <div
        role="progressbar"
        aria-label={`${title} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded bg-slate-700"
      >
        <div className="h-full bg-orange-500 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-slate-300">
        {percent}%{job.message ? ` · ${job.message}` : ""}
      </p>
      {job.error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-2 py-1 text-xs text-red-200">
          {job.error}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {active && (
          <button type="button" className={btn} onClick={() => void cancel()} disabled={busy}>
            Cancel job
          </button>
        )}
        {target && (
          <Link to={target.to} className="text-xs text-orange-300 hover:underline">
            {target.label}
          </Link>
        )}
        <button type="button" className={btn} onClick={() => setLogOpen((o) => !o)}>
          {logOpen ? "Hide log" : "Show log"}
        </button>
      </div>
      {logOpen && <JobLogView projectId={projectId} jobId={job.id} live={active} />}
    </article>
  );
}
