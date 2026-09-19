import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { promoteQueryRun, resumeQueryRun, unpromoteQueryRun } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";
import { JobCard } from "@/jobs/JobCard";
import { formatLocalDate } from "@/models/modelLabels";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { REVIEW_LINK_MAX_IDS, reviewLink, runTitle } from "./queryModel";
import { useTrackedRun } from "./useTrackedRun";

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";
const secondary = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

export function RunCard({ projectId, runId }: { projectId: string; runId: string }) {
  const api = useApi();
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
    void act("promote", async () => {
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
    <p
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200"
    >
      {loadError}
      <button type="button" className={secondary} onClick={retry}>
        Retry
      </button>
    </p>
  );
  if (!run) {
    return alert || <p className="text-sm text-slate-400">Loading run {runId.slice(0, 8)}…</p>;
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
      className="flex max-w-3xl flex-col gap-3 rounded border border-slate-800 bg-slate-800/30 p-4"
    >
      {alert}
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-medium">{runTitle(run)}</h2>
        {run.promoted_at && (
          <span
            className="rounded bg-emerald-800 px-2 py-0.5 text-xs text-emerald-100"
            title={run.promoted_at}
          >
            Accepted as labels
          </span>
        )}
        <span className="text-xs text-slate-400">started {formatLocalDate(run.created_at)}</span>
      </header>
      <p className="text-xs text-slate-400">
        {run.image_ids.length} {run.image_ids.length === 1 ? "image" : "images"}, {tiling}, confidence{" "}
        {run.conf}
        {run.model_name ? `, model ${run.model_name}` : ""}
      </p>
      {job && <JobCard projectId={projectId} job={job} />}
      {interrupted && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondary} onClick={() => void resume()} disabled={busy}>
            Resume run
          </button>
          <span className="text-xs text-slate-400">
            Finished tiles are reused, so the run continues where it stopped.
          </span>
        </div>
      )}
      <p data-testid="box-count" className="text-sm">
        {boxes(run.box_count)} {finished ? "found" : "written so far"}
      </p>
      {finished && run.box_count === 0 && (
        <p
          data-testid="no-boxes-advice"
          className="rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-200"
        >
          Nothing scored at or above confidence {run.conf}. Run again with a lower confidence, or improve the
          model: a model trained on few images, or for few epochs, is rarely sure of anything.
        </p>
      )}
      {!(finished && run.box_count === 0) && (
        <>
          <p className="text-sm">
            <Link to={link.to} className="text-orange-300 hover:underline">
              Review results
            </Link>
            {link.capped && (
              <span className="text-xs text-slate-400">
                {" "}
                (first {REVIEW_LINK_MAX_IDS} of {run.image_ids.length} images)
              </span>
            )}
          </p>
          <form onSubmit={countPromotion} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Minimum confidence
              <input
                aria-label="Minimum confidence"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={minConf}
                onChange={(e) => {
                  setMinConf(e.target.value);
                  setPending(null);
                }}
                className={`${input} w-24`}
              />
            </label>
            <button type="submit" className={primary} disabled={busy}>
              Accept as labels…
            </button>
            {run.promoted_at && (
              <button type="button" className={secondary} onClick={undoPromotion} disabled={busy}>
                Undo acceptance
              </button>
            )}
            <span className="text-xs text-slate-400">
              Counts the run&apos;s unreviewed boxes at or above the threshold, then asks before accepting
              them.
            </span>
          </form>
          {pending && (
            <div
              data-testid="promote-confirm"
              className="flex flex-wrap items-center gap-2 rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm"
            >
              <span>
                {pending.count} unreviewed {pending.count === 1 ? "box" : "boxes"} at or above{" "}
                {pending.threshold} will become ground-truth labels and enter new datasets. Review results
                first if the model is new; Undo acceptance reverses it.
              </span>
              <button type="button" className={primary} onClick={confirmPromotion} disabled={busy}>
                Accept {boxes(pending.count)}
              </button>
              <button type="button" className={secondary} onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {status && (
        <p role="status" className="text-xs text-emerald-300">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
