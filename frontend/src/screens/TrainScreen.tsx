import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import type { TrainRequest } from "@contract/client";
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

const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

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
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Train</h1>
        {jobId && (
          <button type="button" className={`${btn} ml-auto`} onClick={() => setParams({})}>
            New training
          </button>
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
          busy={busy}
          onStart={(req) => void start(req)}
        />
      )}
      {unavailable && (
        <p
          role="note"
          className="rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
        >
          Training is not available yet (it arrives with the training backend).
        </p>
      )}
      {(error || datasets.error || registry.error) && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error ?? datasets.error ?? registry.error}
        </p>
      )}
      {trainJobs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Recent training jobs</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {trainJobs.map((j) => (
              <li key={j.id} className="flex items-center gap-3">
                <span className="font-medium">{jobTitle(j)}</span>
                <span className="text-xs text-slate-400">
                  {stateLabel(j.state)} · {formatLocalDate(j.created_at)}
                </span>
                {j.id !== jobId && (
                  <button type="button" className={btn} onClick={() => setParams({ job: j.id })}>
                    Show {j.id.slice(0, 8)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
