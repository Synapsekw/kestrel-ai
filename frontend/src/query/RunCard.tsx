import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelJob } from "@/api/jobs";
import { promoteQueryRun, resumeQueryRun, unpromoteQueryRun } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";
import { elapsedSeconds, formatDuration, jobTitle, stateLabel } from "@/jobs/jobLabels";
import { JobLogView } from "@/jobs/JobLogView";
import { useNow } from "@/jobs/useNow";
import { formatLocalDate } from "@/library/modelLabels";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Field, Input, Pill, Progress, Skeleton, buttonClass, type PillTone } from "@/ui";
import { REVIEW_LINK_MAX_IDS, reviewLink, runTitle } from "./queryModel";
import { useTrackedRun } from "./useTrackedRun";

const STATE_TONE: Record<Job["state"], PillTone> = {
  queued: "neutral",
  running: "accent",
  succeeded: "ok",
  failed: "danger",
  cancelled: "neutral",
};

/** The run's job: state, progress while it works, the error when it stopped, Cancel and the log. */
function RunJob({ projectId, job, readOnly }: { projectId: string; job: Job; readOnly: boolean }) {
  const api = useApi();
  const active = isActiveJob(job);
  const now = useNow(1000, active);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = elapsedSeconds(job, now);
  const percent = Math.round(job.progress * 100);

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
    <div data-testid={`job-${job.id}`} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <Pill data-testid="jobcard-state" tone={STATE_TONE[job.state]} live={job.state === "running"}>
          {stateLabel(job.state)}
        </Pill>
        <span className="font-medium tabular-nums text-ink">{percent}%</span>
        {job.message && <span className="min-w-0 truncate tabular-nums text-muted">{job.message}</span>}
        {elapsed !== null && <span className="tabular-nums text-muted">{formatDuration(elapsed)}</span>}
        <span className="ml-auto flex items-center gap-1">
          {active && !readOnly && (
            <Button size="sm" variant="ghost" onClick={() => void cancel()} disabled={busy}>
              Cancel job
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setLogOpen((o) => !o)} aria-expanded={logOpen}>
            {logOpen ? "Hide log" : "Show log"}
          </Button>
        </span>
      </div>
      {active && <Progress value={job.progress} running label={`${jobTitle(job)} progress`} />}
      {job.error && <Alert tone="danger">{job.error}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {logOpen && <JobLogView projectId={projectId} jobId={job.id} live={active} />}
    </div>
  );
}

/**
 * One detection run: its job, box count, the review link and accepting its boxes as labels.
 * `readOnly` keeps the facts and the log and drops everything that changes the run.
 */
export function RunCard({
  projectId,
  runId,
  readOnly = false,
}: {
  projectId: string;
  runId: string;
  readOnly?: boolean;
}) {
  const api = useApi();
  const id = useId();
  const { run, job, error: loadError, replace, trackJob, retry } = useTrackedRun(projectId, runId);
  const [minConf, setMinConf] = useState("0.5");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Accepting is two steps: a dry run counts the boxes, the operator confirms that number.
  const [pending, setPending] = useState<{ threshold: number; count: number } | null>(null);
  const boxes = (n: number) => `${n} ${n === 1 ? "box" : "boxes"}`;

  async function act(what: string, fn: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      setStatus(await fn());
    } catch (err) {
      pushLog(`${what} run ${runId} failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, `could not ${what} the run`));
    } finally {
      setBusy(false);
    }
  }

  function countPromotion(e: FormEvent) {
    e.preventDefault();
    const threshold = Number(minConf);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      setError("Minimum confidence must be between 0 and 1.");
      return;
    }
    setPending(null);
    void act("count the boxes of", async () => {
      const { accepted } = await promoteQueryRun(api, projectId, runId, threshold, true);
      if (accepted === 0)
        return `No unreviewed boxes at or above ${threshold}. Lower the minimum confidence or review the images one by one.`;
      setPending({ threshold, count: accepted });
      return null;
    });
  }

  function confirmPromotion() {
    if (!pending) return;
    const { threshold } = pending;
    setPending(null);
    void act("accept the boxes of", async () => {
      const result = await promoteQueryRun(api, projectId, runId, threshold);
      replace(result.query_run);
      return `${boxes(result.accepted)} accepted`;
    });
  }

  function undoPromotion() {
    void act("undo the acceptance of", async () => {
      const result = await unpromoteQueryRun(api, projectId, runId);
      replace(result.query_run);
      return `${boxes(result.reverted)} returned to unreviewed`;
    });
  }

  async function resume() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const resumed = await resumeQueryRun(api, projectId, runId);
      useJobsStore.getState().upsert(resumed);
      trackJob(resumed);
      setStatus(`Resumed (job ${resumed.id.slice(0, 8)})`);
    } catch (err) {
      pushLog(`resume run ${runId} failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not resume the run"));
    } finally {
      setBusy(false);
    }
  }

  // The card keeps rendering when a later poll fails; the alert sits next to it.
  const alert = loadError && (
    <Alert
      tone="danger"
      actions={
        <Button size="sm" onClick={retry}>
          Retry
        </Button>
      }
    >
      {loadError}
    </Alert>
  );
  if (!run) {
    return (
      alert || (
        <div
          role="status"
          aria-label={`Loading run ${runId.slice(0, 8)}`}
          className="flex max-w-3xl flex-col gap-3 rounded-lg border border-line bg-panel p-5"
        >
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="h-1.5 w-full" />
        </div>
      )
    );
  }
  const finished = job !== null && job.state === "succeeded";
  const interrupted = job !== null && !isActiveJob(job) && job.state !== "succeeded";
  const link = reviewLink(projectId, run);
  const tiling = run.tiling.enabled
    ? `tiles ${run.tiling.tile_size} px, overlap ${run.tiling.overlap}, NMS IoU ${run.tiling.nms_iou}`
    : "no tiling";
  return (
    <section
      data-testid="run-card"
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-line bg-panel p-5"
    >
      {alert}
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{runTitle(run)}</h2>
          {run.promoted_at && (
            <Pill tone="ok" title={run.promoted_at}>
              Accepted as labels
            </Pill>
          )}
          <span className="ml-auto text-xs text-muted">started {formatLocalDate(run.created_at)}</span>
        </div>
        <p className="text-[13px] tabular-nums text-muted">
          {run.image_ids.length} {run.image_ids.length === 1 ? "image" : "images"}, {tiling}, confidence{" "}
          {run.conf}
          {run.model_name ? `, model ${run.model_name}` : ""}
        </p>
      </header>
      {job && <RunJob projectId={projectId} job={job} readOnly={readOnly} />}
      {interrupted && !readOnly && (
        <div className="flex flex-wrap items-center gap-3">
          <Button icon="play" onClick={() => void resume()} disabled={busy}>
            Resume run
          </Button>
          <span className="text-[13px] text-muted">
            Finished tiles are reused, so the run continues where it stopped.
          </span>
        </div>
      )}
      <p data-testid="box-count" className="text-sm font-medium tabular-nums">
        {boxes(run.box_count)} {finished ? "found" : "written so far"}
      </p>
      {finished && run.box_count === 0 && (
        <Alert tone="warn" testId="no-boxes-advice">
          Nothing scored at or above confidence {run.conf}. Run again with a lower confidence, or improve the
          model: a model trained on few images, or for few epochs, is rarely sure of anything.
        </Alert>
      )}
      {!readOnly && !(finished && run.box_count === 0) && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Link to={link.to} className={buttonClass("primary", "sm")}>
              Review results
            </Link>
            {link.capped && (
              <span className="text-xs tabular-nums text-muted">
                First {REVIEW_LINK_MAX_IDS} of {run.image_ids.length} images
              </span>
            )}
          </div>
          <form onSubmit={countPromotion} className="flex flex-col gap-2 border-t border-line pt-4">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Minimum confidence" htmlFor={`${id}-min-conf`}>
                <Input
                  id={`${id}-min-conf`}
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minConf}
                  onChange={(e) => {
                    setMinConf(e.target.value);
                    setPending(null);
                  }}
                  className="w-28 tabular-nums"
                />
              </Field>
              <Button type="submit" disabled={busy}>
                Accept as labels…
              </Button>
              {run.promoted_at && (
                <Button variant="ghost" icon="undo" onClick={undoPromotion} disabled={busy}>
                  Undo acceptance
                </Button>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted">
              Counts the run&apos;s unreviewed boxes at or above the threshold, then asks before accepting
              them.
            </p>
          </form>
          {pending && (
            <Alert
              tone="warn"
              testId="promote-confirm"
              actions={
                <>
                  <Button size="sm" variant="primary" onClick={confirmPromotion} disabled={busy}>
                    Accept {boxes(pending.count)} as labels
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                </>
              }
            >
              {pending.count} unreviewed {pending.count === 1 ? "box" : "boxes"} at or above{" "}
              {pending.threshold} will become ground-truth labels and enter new datasets. Review results first
              if the model is new; Undo acceptance reverses it.
            </Alert>
          )}
        </>
      )}
      {status && <Alert tone="ok">{status}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  );
}
