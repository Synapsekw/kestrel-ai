import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { AddToDatasetDialog } from "./AddToDatasetDialog";
import { deleteImages } from "./bulkActions";

interface Props {
  projectId: string;
  selectedIds: string[];
  onLabel: () => void;
  /** Opens the query screen with the selection preloaded (S5). */
  onRunModel: () => void;
  /** The selection is gone after a delete, so the message is handed to the screen to show. */
  onDeleted: (message: string) => void;
  onClear: () => void;
}

const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";

export function SelectionBar({ projectId, selectedIds, onLabel, onRunModel, onDeleted, onClear }: Props) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "dataset" | "confirm-delete">("idle");
  const n = selectedIds.length;

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const deleted = await deleteImages(api, projectId, selectedIds);
      useChangesStore.getState().bumpImages();
      onDeleted(`${deleted} ${deleted === 1 ? "image" : "images"} deleted`);
      setMode("idle");
    } catch (e) {
      pushLog(`delete images failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "delete images failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-slate-700 bg-slate-800/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{n} selected</span>
        <button type="button" className={primary} onClick={onLabel} disabled={busy}>
          Label selected
        </button>
        <button
          type="button"
          className={btn}
          onClick={onRunModel}
          disabled={busy}
          title="Open the query screen with these images selected"
        >
          Run model
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => setMode(mode === "dataset" ? "idle" : "dataset")}
          disabled={busy}
        >
          Add to dataset
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => setMode(mode === "confirm-delete" ? "idle" : "confirm-delete")}
          disabled={busy}
        >
          Delete
        </button>
        <button type="button" className="ml-auto text-xs text-slate-400 hover:text-white" onClick={onClear}>
          Clear selection
        </button>
      </div>
      {mode === "dataset" && (
        <AddToDatasetDialog projectId={projectId} imageIds={selectedIds} onClose={() => setMode("idle")} />
      )}
      {mode === "confirm-delete" && (
        <div className="flex items-center gap-2 text-sm">
          <span>Remove {n} images and their boxes from the project? Original files are not touched.</span>
          <button
            type="button"
            className="rounded bg-red-700 px-3 py-1 text-sm hover:bg-red-600"
            onClick={() => void confirmDelete()}
            disabled={busy}
          >
            Delete {n} images
          </button>
          <button type="button" className={btn} onClick={() => setMode("idle")}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
