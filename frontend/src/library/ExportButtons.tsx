import { useEffect, useState } from "react";
import type { Model } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { exportModel, type ExportFormat } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { RevealButton } from "@/exports/RevealButton";
import { JobCard } from "@/jobs/JobCard";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button } from "@/ui";

interface Props {
  projectId: string;
  model: Model;
  /** Called once when the tracked export job succeeds, so the parent can refetch `model.exports`. */
  onFinished?: () => void;
}

/** Spec section 7: ONNX and TensorRT exports run as jobs; the path lands in `model.exports[format]`. */
export function ExportButtons({ projectId, model, onFinished }: Props) {
  const api = useApi();
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { job } = useTrackedJob(projectId, jobId);
  const exports = Object.entries(model.exports);
  const finished = job?.state === "succeeded";

  useEffect(() => {
    if (finished) onFinished?.();
  }, [finished, onFinished]);

  async function start(format: ExportFormat) {
    setBusy(format);
    setError(null);
    try {
      const j = await exportModel(api, projectId, model.id, { format, imgsz: 1280, half: false });
      useJobsStore.getState().upsert(j);
      setJobId(j.id);
    } catch (e) {
      pushLog(`export ${format} of ${model.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start the export"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Exports</h3>
      {exports.length > 0 ? (
        <ul className="flex flex-col text-[13px]">
          {exports.map(([format, path]) => (
            <li key={format} className="flex h-8 items-center gap-3 border-b border-line last:border-b-0">
              <span className="w-16 text-xs font-medium uppercase text-muted">{format}</span>
              <span className="min-w-0 flex-1 truncate font-mono">{path}</span>
              <RevealButton projectId={projectId} path={path} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Not exported yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon="download"
          loading={busy === "onnx"}
          onClick={() => void start("onnx")}
          disabled={busy !== null}
        >
          Export ONNX
        </Button>
        <Button
          size="sm"
          icon="download"
          loading={busy === "engine"}
          onClick={() => void start("engine")}
          disabled={busy !== null}
        >
          Export TensorRT
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {job && <JobCard projectId={projectId} job={job} />}
    </div>
  );
}
