import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { promoteQueryRun } from "@/api/queryRuns";
import { pushLog } from "@/app/diagnostics";
import { JobCard } from "@/jobs/JobCard";
import { formatDate } from "@/models/modelLabels";
import { REVIEW_LINK_MAX_IDS, reviewLink, runTitle } from "./queryModel";
import { useTrackedRun } from "./useTrackedRun";

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";

export function RunCard({ projectId, runId }: { projectId: string; runId: string }) {
  const api = useApi();
  const { run, job, error: loadError, replace } = useTrackedRun(projectId, runId);
  const [minConf, setMinConf] = useState("0.5");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function promote(e: FormEvent) {
    e.preventDefault();
    const threshold = Number(minConf);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      setError("Minimum confidence must be between 0 and 1.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const result = await promoteQueryRun(api, projectId, runId, threshold);
      replace(result.query_run);
      setStatus(`${result.accepted} ${result.accepted === 1 ? "box" : "boxes"} accepted`);
    } catch (err) {
      pushLog(`promote run ${runId} failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not promote the run"));
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
        {loadError}
      </p>
    );
  }
  if (!run) return <p className="text-sm text-slate-400">Loading run {runId.slice(0, 8)}…</p>;
  const link = reviewLink(projectId, run);
  const tiling = run.tiling.enabled
    ? `tiles ${run.tiling.tile_size} px, overlap ${run.tiling.overlap}, NMS IoU ${run.tiling.nms_iou}`
    : "no tiling";
  return (
    <section
      data-testid="run-card"
      className="flex max-w-3xl flex-col gap-3 rounded border border-slate-800 bg-slate-800/30 p-4"
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-medium">{runTitle(run)}</h2>
        {run.promoted_at && (
          <span
            className="rounded bg-emerald-800 px-2 py-0.5 text-xs text-emerald-100"
            title={run.promoted_at}
          >
            Promoted
          </span>
        )}
        <span className="text-xs text-slate-400">started {formatDate(run.created_at)}</span>
      </header>
      <p className="text-xs text-slate-400">
        {run.image_ids.length} {run.image_ids.length === 1 ? "image" : "images"}, {tiling}, confidence{" "}
        {run.conf}
        {run.model_name ? `, model ${run.model_name}` : ""}
      </p>
      {job && <JobCard projectId={projectId} job={job} />}
      <p data-testid="box-count" className="text-sm">
        {run.box_count} {run.box_count === 1 ? "box" : "boxes"} written so far
      </p>
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
      <form onSubmit={(e) => void promote(e)} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Minimum confidence
          <input
            aria-label="Minimum confidence"
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={minConf}
            onChange={(e) => setMinConf(e.target.value)}
            className={`${input} w-24`}
          />
        </label>
        <button type="submit" className={primary} disabled={busy}>
          Promote
        </button>
        <span className="text-xs text-slate-400">
          Accepts the run&apos;s unreviewed boxes at or above the threshold.
        </span>
      </form>
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
