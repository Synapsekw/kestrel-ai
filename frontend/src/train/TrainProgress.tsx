import { JobCard } from "@/jobs/JobCard";
import { elapsedSeconds, formatDuration } from "@/jobs/jobLabels";
import { useNow } from "@/jobs/useNow";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { formatMetric } from "@/models/modelLabels";
import { isActiveJob } from "@/store/jobs";
import { parseEpochMessage } from "./trainModel";

const tile = "rounded bg-slate-900 px-3 py-2";
const dt = "text-xs uppercase tracking-wide text-slate-500";
const btn = "rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-50";

const HEADLINE: Partial<Record<string, string>> = {
  succeeded: "Training finished: the model is registered.",
  failed: "Training failed.",
  cancelled: "Training cancelled.",
};

/** Live training card: epoch and mAP50 from the `job.progress` message, elapsed from `started_at`, log tail. */
export function TrainProgress({ projectId, jobId }: { projectId: string; jobId: string }) {
  const { job, error, retry } = useTrackedJob(projectId, jobId);
  const active = job ? isActiveJob(job) : true;
  const now = useNow(1000, active);
  const alert = error && (
    <p
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200"
    >
      Job {jobId.slice(0, 8)} is not available: {error}
      <button type="button" className={btn} onClick={retry}>
        Retry
      </button>
    </p>
  );
  if (!job) {
    return alert || <p className="text-sm text-slate-400">Loading job {jobId.slice(0, 8)}…</p>;
  }
  const epoch = parseEpochMessage(job.message);
  const elapsed = elapsedSeconds(job, now);
  const headline = HEADLINE[job.state] ?? null;
  return (
    <section data-testid="train-progress" className="flex max-w-3xl flex-col gap-3">
      {alert}
      <dl className="grid grid-cols-3 gap-2 md:grid-cols-5">
        <div className={tile}>
          <dt className={dt}>Epoch</dt>
          <dd data-testid="epoch" className="text-lg tabular-nums">
            {epoch ? `${epoch.epoch} / ${epoch.epochs}` : "–"}
          </dd>
        </div>
        <div className={tile}>
          <dt className={dt}>mAP50</dt>
          <dd data-testid="map50" className="text-lg tabular-nums">
            {formatMetric(epoch?.map50)}
          </dd>
        </div>
        <div className={tile}>
          <dt className={dt}>Loss</dt>
          <dd data-testid="loss" className="text-sm tabular-nums">
            {epoch && Object.keys(epoch.losses).length > 0
              ? Object.entries(epoch.losses)
                  .map(([name, value]) => `${name} ${value.toFixed(3)}`)
                  .join(" ")
              : "–"}
          </dd>
        </div>
        <div className={tile}>
          <dt className={dt}>ETA</dt>
          <dd data-testid="eta" className="text-lg tabular-nums">
            {epoch?.etaSeconds == null ? "–" : formatDuration(epoch.etaSeconds)}
          </dd>
        </div>
        <div className={tile}>
          <dt className={dt}>Elapsed</dt>
          <dd data-testid="elapsed" className="text-lg tabular-nums">
            {elapsed === null ? "–" : formatDuration(elapsed)}
          </dd>
        </div>
      </dl>
      {headline && (
        <p
          role="status"
          className={`text-sm ${job.state === "succeeded" ? "text-emerald-300" : "text-slate-300"}`}
        >
          {headline}
        </p>
      )}
      <JobCard projectId={projectId} job={job} showLog />
    </section>
  );
}
