import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { elapsedSeconds, formatDuration, jobTitle, resultTarget, stateLabel } from "@/jobs/jobLabels";
import { JobLogView } from "@/jobs/JobLogView";
import { useNow } from "@/jobs/useNow";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { formatMetric } from "@/library/modelLabels";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Disclosure, Pill, Progress, Skeleton, buttonClass, type PillTone } from "@/ui";
import { parseEpochMessage, resultAdvice } from "./trainModel";

const STATE_TONE: Record<Job["state"], PillTone> = {
  queued: "neutral",
  running: "accent",
  succeeded: "ok",
  failed: "danger",
  cancelled: "neutral",
};

function Stat({ term, testId, children }: { term: string; testId: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted">{term}</dt>
      <dd data-testid={testId} className="text-xl font-semibold tabular-nums tracking-tight">
        {children}
      </dd>
    </div>
  );
}

/** Live training card: epoch and mAP50 from the `job.progress` message, elapsed from `started_at`, log tail. */
export function TrainProgress({ projectId, jobId }: { projectId: string; jobId: string }) {
  const api = useApi();
  const { job, error, retry } = useTrackedJob(projectId, jobId);
  const active = job ? isActiveJob(job) : true;
  const now = useNow(1000, active);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      useJobsStore.getState().upsert(await cancelJob(api, projectId, jobId));
    } catch (e) {
      pushLog(`cancel job ${jobId} failed: ${messageOf(e, String(e))}`);
      setCancelError(messageOf(e, "could not cancel the job"));
    } finally {
      setCancelling(false);
    }
  }

  const alert = error && (
    <Alert
      tone="danger"
      actions={
        <Button size="sm" icon="refresh" onClick={retry}>
          Retry
        </Button>
      }
    >
      Job {jobId.slice(0, 8)} is not available: {error}
    </Alert>
  );
  if (!job) {
    return (
      alert || (
        <div
          role="status"
          aria-label={`Loading job ${jobId.slice(0, 8)}`}
          className="flex max-w-3xl flex-col gap-3"
        >
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-1.5 w-full rounded-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )
    );
  }
  const epoch = parseEpochMessage(job.message);
  const elapsed = elapsedSeconds(job, now);
  const weak = job.state === "succeeded" ? resultAdvice(epoch?.map50) : null;
  const target = resultTarget(job, projectId);
  const title = jobTitle(job);
  const losses =
    epoch && Object.keys(epoch.losses).length > 0
      ? Object.entries(epoch.losses)
          .map(([name, value]) => `${name} ${value.toFixed(3)}`)
          .join(" ")
      : "–";

  return (
    <section
      data-testid="train-progress"
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-line bg-panel p-5"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        <Pill tone={STATE_TONE[job.state]} live={job.state === "running"} size="sm">
          {stateLabel(job.state)}
        </Pill>
        <span className="ml-auto font-mono text-xs text-muted">{job.id.slice(0, 8)}</span>
      </header>

      <Progress value={job.progress} running={active} label={`${title} progress`} />

      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        <Stat term="Epoch" testId="epoch">
          {epoch ? `${epoch.epoch} / ${epoch.epochs}` : "–"}
        </Stat>
        <Stat term="mAP50" testId="map50">
          {formatMetric(epoch?.map50)}
        </Stat>
        <Stat term="Elapsed" testId="elapsed">
          {elapsed === null ? "–" : formatDuration(elapsed)}
        </Stat>
      </dl>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-muted">
        <div className="flex gap-1.5">
          <dt>Loss</dt>
          <dd data-testid="loss" className="tabular-nums text-ink">
            {losses}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>ETA</dt>
          <dd data-testid="eta" className="tabular-nums text-ink">
            {epoch?.etaSeconds == null ? "–" : formatDuration(epoch.etaSeconds)}
          </dd>
        </div>
      </dl>

      {job.state === "succeeded" && !weak && (
        <Alert tone="ok" title="Training finished: the model is in the library." />
      )}
      {weak && (
        <Alert tone="warn" testId="result-advice" title="Training finished: the model is in the library.">
          {weak}
        </Alert>
      )}
      {job.state === "failed" && (
        <Alert tone="danger" title="Training failed.">
          {job.error}
        </Alert>
      )}
      {job.state === "cancelled" && <Alert tone="info" title="Training cancelled." />}
      {alert}
      {cancelError && <Alert tone="danger">{cancelError}</Alert>}

      {(active || target) && (
        <div className="flex flex-wrap items-center gap-2">
          {target && (
            <Link to={target.to} className={buttonClass("primary", "sm")}>
              {target.label}
            </Link>
          )}
          {active && (
            <Button size="sm" icon="x" onClick={() => void cancel()} loading={cancelling}>
              Cancel job
            </Button>
          )}
        </div>
      )}

      <Disclosure label="Show log" defaultOpen={job.state === "failed"}>
        <JobLogView projectId={projectId} jobId={job.id} live={active} />
      </Disclosure>
    </section>
  );
}
