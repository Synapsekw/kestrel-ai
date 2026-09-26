import { useState } from "react";
import type { Job, LibraryModel } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { exportLibraryModel, type ExportFormat } from "@/api/library";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button } from "@/ui";

interface Props {
  model: LibraryModel;
  /** The export runs as a library job; the caller shows its progress and refetches the model after. */
  onStarted: (job: Job) => void;
}

/** ONNX and TensorRT copies for other applications; each lands in `model.exports[format]`. */
export function ExportButtons({ model, onStarted }: Props) {
  const api = useApi();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exports = Object.entries(model.exports);

  async function start(format: ExportFormat) {
    setBusy(format);
    setError(null);
    try {
      onStarted(await exportLibraryModel(api, model.id, { format, imgsz: 1280, half: false }));
    } catch (e) {
      pushLog(`export ${format} of ${model.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start the export"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Copies for other applications</h3>
      {exports.length > 0 ? (
        <ul className="flex flex-col text-[13px]">
          {exports.map(([format, path]) => (
            <li key={format} className="flex h-8 items-center gap-3 border-b border-line last:border-b-0">
              <span className="w-16 text-xs font-medium uppercase text-muted">{format}</span>
              <span className="min-w-0 flex-1 truncate font-mono" title={path}>
                {path}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No copies yet.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          icon="download"
          loading={busy === "onnx"}
          onClick={() => void start("onnx")}
          disabled={busy !== null || model.state === "unavailable"}
        >
          Export ONNX
        </Button>
        <Button
          size="sm"
          icon="download"
          loading={busy === "engine"}
          onClick={() => void start("engine")}
          disabled={busy !== null || model.state === "unavailable"}
        >
          Export TensorRT
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
