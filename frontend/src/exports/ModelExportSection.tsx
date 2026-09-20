import { useId, useState } from "react";
import type { Model } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { exportModel } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { RevealButton } from "@/exports/RevealButton";
import { JobCard } from "@/jobs/JobCard";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Field, Select } from "@/ui";

interface Props {
  projectId: string;
  models: Model[];
}

/** Trained models first: the one an analyst just trained is the natural default pick. */
function orderModels(models: Model[]): Model[] {
  return [...models].sort((a, b) => Number(b.kind === "trained") - Number(a.kind === "trained"));
}

export function ModelExportSection({ projectId, models }: Props) {
  const api = useApi();
  const id = useId();
  const ordered = orderModels(models);
  const [modelId, setModelId] = useState<string>(ordered[0]?.id ?? "");
  const model = models.find((m) => m.id === modelId) ?? ordered[0] ?? null;
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useTrackedJob(projectId, jobId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <section
      aria-label="Model for other applications"
      className="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5"
    >
      <h2 className="text-base font-semibold">Model for other applications</h2>
      <p className="max-w-prose text-sm leading-relaxed text-muted">
        ONNX is the file format most other tools load a model from — OpenCV, ONNX Runtime and most inference
        servers all read it directly. The <code className="font-mono">.pt</code> weights next to it are for
        Ultralytics/PyTorch only; export ONNX to use this model somewhere else.
      </p>
      {models.length === 0 ? (
        <p className="text-sm text-muted">No models yet.</p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Model" htmlFor={`${id}-model`} className="w-64">
            <Select
              id={`${id}-model`}
              aria-label="Model"
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
            </Select>
          </Field>
          <Button icon="download" loading={busy} disabled={!model} onClick={() => void start()}>
            Export ONNX
          </Button>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {job && job.type === "export" && <JobCard projectId={projectId} job={job} />}
      {path && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="min-w-0 truncate font-mono text-xs">{path}</span>
          <RevealButton projectId={projectId} path={path} />
        </div>
      )}
    </section>
  );
}
