import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { Alert, Button } from "@/ui";
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

/** A secondary button redrawn for the dark bar (important: it overrides the variant's colours). */
const onInverse = "!border-inverse-fg/25 !bg-transparent !text-inverse-fg hover:!bg-inverse-fg/10";

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
      // No local bumpImages(): bulk-mark-empty publishes its own images.changed over the
      // websocket, which the list already reloads on (unlike bulk-delete, which publishes none).
      const { updated, skipped } = await markImagesEmpty(api, projectId, selectedIds);
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
      onMarked(`${updated} no longer marked empty`);
    } catch (e) {
      pushLog(`unmark empty failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "unmark empty failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col rounded-lg bg-inverse px-4 text-inverse-fg shadow-float animate-reveal motion-reduce:animate-none">
        <div className="flex min-h-11 flex-wrap items-center gap-2 py-1.5">
          <span className="mr-1 text-sm font-medium tabular-nums">{n} selected</span>
          <Button variant="primary" size="sm" icon="label" onClick={onLabel} disabled={busy}>
            Label selected
          </Button>
          <Button
            size="sm"
            className={onInverse}
            onClick={onRunModel}
            disabled={busy}
            title="Open Detect with these images selected"
          >
            Run model
          </Button>
          <Button
            size="sm"
            className={onInverse}
            aria-haspopup="dialog"
            onClick={() => setMode(mode === "dataset" ? "idle" : "dataset")}
            disabled={busy}
          >
            Add to dataset
          </Button>
          <Button
            size="sm"
            className={onInverse}
            aria-expanded={mode === "confirm-mark"}
            onClick={() => setMode(mode === "confirm-mark" ? "idle" : "confirm-mark")}
            disabled={busy}
          >
            Mark as empty
          </Button>
          {emptyCount > 0 && (
            <Button size="sm" className={onInverse} onClick={() => void unmark()} disabled={busy}>
              Unmark empty
            </Button>
          )}
          <Button
            size="sm"
            className={onInverse}
            aria-expanded={mode === "confirm-delete"}
            onClick={() => setMode(mode === "confirm-delete" ? "idle" : "confirm-delete")}
            disabled={busy}
          >
            Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto !text-inverse-fg/75 hover:!bg-inverse-fg/10 hover:!text-inverse-fg"
            onClick={onClear}
          >
            Clear selection
          </Button>
        </div>
        {mode === "confirm-delete" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-inverse-fg/15 py-2 text-sm animate-reveal motion-reduce:animate-none">
            <span className="mr-1">
              Remove {n} images and their boxes from the project? Original files are not touched.
            </span>
            <Button
              variant="danger"
              size="sm"
              icon="trash"
              className="!border-transparent !bg-danger !text-ground hover:!bg-danger/90"
              onClick={() => void confirmDelete()}
              loading={busy}
            >
              Delete {n} images
            </Button>
            <Button size="sm" className={onInverse} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        )}
        {mode === "confirm-mark" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-inverse-fg/15 py-2 text-sm animate-reveal motion-reduce:animate-none">
            <span className="mr-1">
              Mark {n} {n === 1 ? "image" : "images"} as empty?
              {pendingCount > 0 &&
                ` ${pendingCount} pending ${pendingCount === 1 ? "suggestion" : "suggestions"} on them will be rejected.`}
            </span>
            <Button variant="primary" size="sm" onClick={() => void confirmMark()} loading={busy}>
              Mark {n} as empty
            </Button>
            <Button size="sm" className={onInverse} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        )}
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
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
