import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AppJob } from "@/api/appJobs";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { cancelJob } from "@/api/jobs";
import { pushLog } from "@/app/diagnostics";
import { formatLocalDate } from "@/library/modelLabels";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import {
  Alert,
  Button,
  IconButton,
  InspectorPane,
  InspectorSection,
  Pill,
  Progress,
  buttonClass,
} from "@/ui";
import { elapsedSeconds, formatDuration, jobTitle, resultTarget, stateLabel } from "./jobLabels";
import { JobLogView } from "./JobLogView";
import { JOB_STATE_TONE, projectLabel } from "./jobsFilters";
import { useNow } from "./useNow";

function Row({ term, children, mono }: { term: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted">{term}</dt>
      <dd className={mono ? "min-w-0 truncate font-mono text-xs" : "min-w-0 truncate tabular-nums"}>
        {children}
      </dd>
    </div>
  );
}

/** F §10.2: one job's details, its log tail, Cancel, and Go to result. */
export function JobInspector({ job, onClose }: { job: AppJob; onClose: () => void }) {
  const api = useApi();
  const active = isActiveJob(job);
  const now = useNow(1000, active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const elapsed = elapsedSeconds(job, now);
  const target = resultTarget(job, job.project_id);
  const title = jobTitle(job);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      useJobsStore.getState().upsert(await cancelJob(api, job.project_id, job.id));
    } catch (e) {
      pushLog(`cancel job ${job.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not cancel the job"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <InspectorPane
      label="Job"
      header={
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h2>
          <Pill tone={JOB_STATE_TONE[job.state]} live={job.state === "running"} size="sm">
            {stateLabel(job.state)}
          </Pill>
          <IconButton icon="x" label="Close job" size="sm" onClick={onClose} />
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {target && (
            <Link to={target.to} className={buttonClass("primary", "sm")}>
              {target.label}
            </Link>
          )}
          {active && (
            <Button size="sm" loading={busy} onClick={() => void cancel()}>
              Cancel job
            </Button>
          )}
        </div>
      }
    >
      <InspectorSection title="Details">
        <Progress value={job.progress} running={job.state === "running"} label={`${title} progress`} />
        <dl className="mt-2 divide-y divide-line">
          <Row term="Project">{projectLabel(job)}</Row>
          <Row term="Progress">
            {Math.round(job.progress * 100)}%{job.message ? ` · ${job.message}` : ""}
          </Row>
          <Row term="Started">{job.started_at ? formatLocalDate(job.started_at) : "Not yet"}</Row>
          <Row term="Duration">{elapsed === null ? "–" : formatDuration(elapsed)}</Row>
          <Row term="Job" mono>
            {job.id}
          </Row>
        </dl>
        {job.error && <Alert tone="danger">{job.error}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
      </InspectorSection>
      <InspectorSection title="Log">
        <JobLogView projectId={job.project_id} jobId={job.id} live={active} />
      </InspectorSection>
    </InspectorPane>
  );
}
