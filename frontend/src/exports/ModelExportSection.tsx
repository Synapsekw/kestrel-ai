import { useState } from "react";
import type { Model } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { revealInExplorer } from "@/api/exports";
import { exportModel } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { JobCard } from "@/jobs/JobCard";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";

interface Props {
  projectId: string;
  models: Model[];
}

/** Trained models first: the one an analyst just trained is the natural default pick. */
function orderModels(models: Model[]): Model[] {
  return [...models].sort((a, b) => Number(b.kind === "trained") - Number(a.kind === "trained"));
}

const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";
const smallBtn = "rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800 disabled:opacity-50";

export function ModelExportSection({ projectId, models }: Props) {
  const api = useApi();
  const ordered = orderModels(models);
  const [modelId, setModelId] = useState<string>(ordered[0]?.id ?? "");
  const model = models.find((m) => m.id === modelId) ?? ordered[0] ?? null;
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useTrackedJob(projectId, jobId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  const jobPath =
    job && job.type === "export" && job.state === "succeeded" && typeof job.result?.path === "string"
      ? job.result.path
      : null;
  const path = jobPath ?? model?.exports.onnx ?? null;

  async function start() {
    if (!model) return;
    setBusy(true);
    setError(null);
    try {
      const j = await exportModel(api, projectId, model.id, { format: "onnx", imgsz: 1280, half: false });
      useJobsStore.getState().upsert(j);
      setJobId(j.id);
    } catch (e) {
      pushLog(`export onnx of ${model.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start the export"));
    } finally {
      setBusy(false);
    }
  }

  async function show() {
    if (!path) return;
    setRevealBusy(true);
    setRevealError(null);
    try {
      await revealInExplorer(api, projectId, path);
    } catch (e) {
      pushLog(`reveal ${path} failed: ${messageOf(e, String(e))}`);
      setRevealError(messageOf(e, "could not open Explorer"));
    } finally {
      setRevealBusy(false);
    }
  }

  return (
    <section
      aria-label="Model for other applications"
      className="flex flex-col gap-3 rounded border border-slate-800 bg-slate-800/30 p-4"
    >
      <h2 className="text-lg font-medium">Model for other applications</h2>
      <p className="text-sm text-slate-300">
        ONNX is the file format most other tools load a model from — OpenCV, ONNX Runtime and most inference
        servers all read it directly. The <code className="font-mono">.pt</code> weights next to it are for
        Ultralytics/PyTorch only; export ONNX to use this model somewhere else.
      </p>
      {models.length === 0 ? (
        <p className="text-sm text-slate-400">No models yet.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Model"
            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
            value={model?.id ?? ""}
            onChange={(e) => {
              setModelId(e.target.value);
              setJobId(null);
            }}
          >
            {ordered.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button type="button" className={btn} onClick={() => void start()} disabled={busy || !model}>
            Export ONNX
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      {job && job.type === "export" && <JobCard projectId={projectId} job={job} />}
      {path && (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs">{path}</span>
          <button type="button" className={smallBtn} disabled={revealBusy} onClick={() => void show()}>
            Show in folder
          </button>
        </div>
      )}
      {revealError && (
        <p role="alert" className="text-xs text-red-300">
          {revealError}
        </p>
      )}
    </section>
  );
}
