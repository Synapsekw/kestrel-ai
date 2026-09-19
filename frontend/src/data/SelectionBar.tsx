import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { AddToDatasetDialog } from "./AddToDatasetDialog";
import { deleteImages, markImagesEmpty, unmarkImagesEmpty } from "./bulkActions";

interface Props {
  projectId: string;
  selectedIds: string[];
  /** How many of the selection have an accepted or edited box: passed on to the dataset dialog. */
  labeledCount: number;
  /** How many of the selection are already marked empty (E4): offers "Unmark empty" when > 0. */
  emptyCount: number;
  /** How many are neither labeled nor marked: passed on to the dataset dialog's warning. */
  unlabeledCount: number;
  /** Sum of pending_count over the selection: named in the "Mark as empty" confirmation. */
  pendingCount: number;
  onLabel: () => void;
  /** Opens the query screen with the selection preloaded (S5). */
  onRunModel: () => void;
  /** The selection is gone after a delete, so the message is handed to the screen to show. */
  onDeleted: (message: string) => void;
  /** The selection is cleared after marking (E4), like a delete, so the message is handed to the screen to show. */
  onMarked: (message: string) => void;
  onClear: () => void;
}

const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";

export function SelectionBar({
  projectId,
  selectedIds,
  labeledCount,
  emptyCount,
  unlabeledCount,
  pendingCount,
  onLabel,
  onRunModel,
  onDeleted,
  onMarked,
  onClear,
}: Props) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "dataset" | "confirm-delete" | "confirm-mark">("idle");
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

  async function confirmMark() {
    setBusy(true);
    setError(null);
    try {
      const { updated, skipped } = await markImagesEmpty(api, projectId, selectedIds);
      useChangesStore.getState().bumpImages();
      const skippedNote = skipped > 0 ? `, ${skipped} skipped because they have accepted boxes` : "";
      // `already` (already marked before this call) is computed from the loaded rows, not the
      // response: the backend's `updated` counts neither the skipped nor the already-marked ones.
      const alreadyNote = emptyCount > 0 ? `, ${emptyCount} already marked` : "";
      onMarked(`${updated} marked as empty${skippedNote}${alreadyNote}`);
      setMode("idle");
    } catch (e) {
      pushLog(`mark as empty failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "mark as empty failed"));
    } finally {
      setBusy(false);
    }
  }

  async function unmark() {
    setBusy(true);
    setError(null);
    try {
      const { updated } = await unmarkImagesEmpty(api, projectId, selectedIds);
      useChangesStore.getState().bumpImages();
      onMarked(`${updated} no longer marked empty`);
    } catch (e) {
      pushLog(`unmark empty failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "unmark empty failed"));
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
          onClick={() => setMode(mode === "confirm-mark" ? "idle" : "confirm-mark")}
          disabled={busy}
        >
          Mark as empty
        </button>
        {emptyCount > 0 && (
          <button type="button" className={btn} onClick={() => void unmark()} disabled={busy}>
            Unmark empty
          </button>
        )}
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
        <AddToDatasetDialog
          projectId={projectId}
          imageIds={selectedIds}
          labeledCount={labeledCount}
          emptyCount={emptyCount}
          unlabeledCount={unlabeledCount}
          onClose={() => setMode("idle")}
        />
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
      {mode === "confirm-mark" && (
        <div className="flex items-center gap-2 text-sm">
          <span>
            Mark {n} {n === 1 ? "image" : "images"} as empty?
            {pendingCount > 0 &&
              ` ${pendingCount} pending ${pendingCount === 1 ? "proposal" : "proposals"} on them will be rejected.`}
          </span>
          <button type="button" className={primary} onClick={() => void confirmMark()} disabled={busy}>
            Mark {n} as empty
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
