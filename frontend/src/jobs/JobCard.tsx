import { useState } from "react";
import { Link } from "react-router-dom";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Icon, Pill, Progress, cx, focusRing, type IconName, type PillTone } from "@/ui";
import { elapsedSeconds, formatDuration, jobTitle, resultTarget, stateLabel } from "./jobLabels";
import { JobLogView } from "./JobLogView";
import { useNow } from "./useNow";

interface Props {
  projectId: string;
  job: Job;
  /** Start with the log open (the training screen). */
  showLog?: boolean;
}

const TYPE_ICON: Record<Job["type"], IconName> = {
  import: "import",
  train: "train",
  infer: "detect",
  dataset: "datasets",
  export: "download",
  results_export: "download",
  map_import: "map",
  map_detect: "detect",
  map_export: "download",
  library_import: "import",
  library_export: "download",
  library_starter: "models",
  library_adopt: "models",
  map_move: "map",
  accept_above: "detect",
  recount: "detect",
  area_recount: "map",
  detect_export: "download",
  pointcloud_import: "cloud",
  pointcloud_export: "cloud",
  surface_build: "volume",
  volume_calc: "volume",
  volume_export: "volume",
  design_import: "volume",
  project_migrate: "folder",
  findings_backfill: "review",
  findings_recount: "refresh",
  dataset_build: "datasets",
};

const STATE_TONE: Record<Job["state"], PillTone> = {
  queued: "neutral",
  running: "accent",
  succeeded: "ok",
  failed: "danger",
  cancelled: "neutral",
};

/** One job as a row of the jobs drawer: type icon, name, state, progress, elapsed time, actions. */
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
    <article data-testid={`job-${job.id}`} className="flex flex-col gap-2 py-3 text-sm">
      <header className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-well text-muted">
          <Icon name={TYPE_ICON[job.type]} size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium" title={title}>
          {title}
        </span>
        <Pill data-testid="jobcard-state" tone={STATE_TONE[job.state]} live={job.state === "running"}>
          {stateLabel(job.state)}
        </Pill>
      </header>
      <Progress value={job.progress} running={job.state === "running"} label={`${title} progress`} />
      <p className="flex items-baseline gap-2 text-xs text-muted">
        <span className="min-w-0 flex-1 truncate">
          <span className="tabular-nums">{percent}%</span>
          {job.message ? ` · ${job.message}` : ""}
        </span>
        {elapsed !== null && <span className="shrink-0 tabular-nums">{formatDuration(elapsed)}</span>}
        <span className="shrink-0 font-mono text-dim">{job.id.slice(0, 8)}</span>
      </p>
      {job.error && <Alert tone="danger">{job.error}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {active && (
          <Button size="sm" onClick={() => void cancel()} loading={busy}>
            Cancel job
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-expanded={logOpen} onClick={() => setLogOpen((o) => !o)}>
          {logOpen ? "Hide log" : "Show log"}
        </Button>
        {target && (
          <Link
            to={target.to}
            className={cx(
              "ml-auto inline-flex items-center gap-1 rounded-md text-xs font-medium text-accent hover:underline",
              focusRing,
            )}
          >
            {target.label}
            <Icon name="arrow-right" size={13} />
          </Link>
        )}
      </div>
      {logOpen && <JobLogView projectId={projectId} jobId={job.id} live={active} />}
    </article>
  );
}
