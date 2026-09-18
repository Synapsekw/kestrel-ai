import { useEffect, useState } from "react";
import type { Model } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { exportModel, type ExportFormat } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { JobCard } from "@/jobs/JobCard";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";

const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

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
  const job = useTrackedJob(projectId, jobId);
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
      <h3 className="text-sm font-medium">Exports</h3>
      {exports.length > 0 ? (
        <ul className="text-sm">
          {exports.map(([format, path]) => (
            <li key={format} className="flex gap-2">
              <span className="w-16 uppercase text-slate-400">{format}</span>
              <span className="font-mono text-xs">{path}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">Not exported yet.</p>
      )}
      <div className="flex gap-2">
        <button type="button" className={btn} onClick={() => void start("onnx")} disabled={busy !== null}>
          Export ONNX
        </button>
        <button type="button" className={btn} onClick={() => void start("engine")} disabled={busy !== null}>
          Export TensorRT
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      {job && <JobCard projectId={projectId} job={job} />}
    </div>
  );
}
