import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { Job, TrainRequest } from "@contract/client";
import { useApi } from "@/api/client";
import { isNotImplemented, messageOf } from "@/api/errors";
import { trainModel } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { jobTitle, stateLabel } from "@/jobs/jobLabels";
import { formatLocalDate } from "@/models/modelLabels";
import { useModels } from "@/models/useModels";
import { useJobsStore } from "@/store/jobs";
import { TrainForm } from "@/train/TrainForm";
import { TrainProgress } from "@/train/TrainProgress";
import { useDatasets } from "@/train/useDatasets";
import { Alert, Button, Pill, type PillTone } from "@/ui";

const STATE_TONE: Record<Job["state"], PillTone> = {
  queued: "neutral",
  running: "accent",
  succeeded: "ok",
  failed: "danger",
  cancelled: "neutral",
};

export function TrainScreen() {
  const { projectId = "" } = useParams();
  const api = useApi();
  const [params, setParams] = useSearchParams();
  const jobId = params.get("job");
  const datasets = useDatasets(projectId);
  const registry = useModels(projectId);
  const jobs = useJobsStore((s) => s.jobs);
  const trainJobs = useMemo(
    () =>
      Object.values(jobs)
        .filter((j) => j.project_id === projectId && j.type === "train")
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [jobs, projectId],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function start(req: TrainRequest) {
    setBusy(true);
    setError(null);
    setUnavailable(false);
    try {
      const job = await trainModel(api, projectId, req);
      useJobsStore.getState().upsert(job);
      setParams({ job: job.id });
    } catch (e) {
      pushLog(`start training failed: ${messageOf(e, String(e))}`);
      if (isNotImplemented(e)) setUnavailable(true);
      else setError(messageOf(e, "could not start training"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Train</h1>
        {jobId && (
          <Button icon="plus" className="ml-auto" onClick={() => setParams({})}>
            New training
          </Button>
        )}
      </div>
      {jobId ? (
        <TrainProgress projectId={projectId} jobId={jobId} />
      ) : (
        <TrainForm
          projectId={projectId}
          datasets={datasets.datasets}
          models={registry.models}
          datasetsUnavailable={datasets.unavailable}
          modelsUnavailable={registry.unavailable}
          modelsLoading={registry.loading}
          modelsError={registry.error}
          busy={busy}
          onStart={(req) => void start(req)}
          initialDatasetId={params.get("dataset") ?? undefined}
        />
      )}
      {unavailable && (
        <div role="note" className="max-w-3xl">
          <Alert tone="info">Training is not available yet (it arrives with the training backend).</Alert>
        </div>
      )}
      {(error || datasets.error || registry.error) && (
        <Alert tone="danger" className="max-w-3xl">
          {error ?? datasets.error ?? registry.error}
        </Alert>
      )}
      {trainJobs.length > 0 && (
        <section className="flex max-w-3xl flex-col gap-2">
          <h2 className="text-base font-semibold">Recent training jobs</h2>
          <ul className="flex flex-col">
            {trainJobs.map((j) => (
              <li
                key={j.id}
                className="flex h-10 items-center gap-3 border-b border-line text-sm last:border-b-0"
              >
                <span className="min-w-0 truncate font-medium">{jobTitle(j)}</span>
                <Pill tone={STATE_TONE[j.state]} live={j.state === "running"} size="sm">
                  {stateLabel(j.state)}
                </Pill>
                <span className="text-xs tabular-nums text-muted">{formatLocalDate(j.created_at)}</span>
                {j.id === jobId ? (
                  <span className="ml-auto text-xs text-muted">Shown above</span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => setParams({ job: j.id })}
                  >
                    Show {j.id.slice(0, 8)}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
