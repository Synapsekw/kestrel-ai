import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { deleteImages, markImagesEmpty } from "@/data/bulkActions";
import { EMPTY_SELECTION, type SelectionState } from "@/data/selection";
import { useChangesStore } from "@/store/changes";
import { Button, Dialog, GlassPanel, toast } from "@/ui";

export interface BrowserSelectionBarProps {
  projectId: string;
  selection: SelectionState;
  onSelectionChange: (next: SelectionState) => void;
  /** Batch detection on the selection (FA/FW own the job); hidden when absent. */
  onDetect?: (ids: string[]) => void;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Spec §7.2: with a multi-selection the bar offers Detect on selection, Nothing to report, Delete. */
export function BrowserSelectionBar({
  projectId,
  selection,
  onSelectionChange,
  onDetect,
}: BrowserSelectionBarProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ids = [...selection.selected];
  if (ids.length === 0) return null;

  async function nothingToReport() {
    setBusy(true);
    try {
      const r = await markImagesEmpty(api, projectId, ids);
      toast(
        r.skipped ? "info" : "ok",
        `${plural(r.updated, "image")} marked as nothing to report.` +
          (r.skipped ? ` ${r.skipped} skipped: they have annotations.` : ""),
      );
      useChangesStore.getState().bumpImages();
    } catch (e) {
      toast("danger", messageOf(e, "could not mark the images"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const n = await deleteImages(api, projectId, ids);
      toast("ok", `${plural(n, "image")} deleted.`);
      setConfirming(false);
      onSelectionChange(EMPTY_SELECTION);
      useChangesStore.getState().bumpImages();
    } catch (e) {
      toast("danger", messageOf(e, "could not delete the images"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassPanel variant="pane" className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
      <span className="font-mono text-ink">{ids.length} selected</span>
      {onDetect && (
        <Button size="sm" variant="secondary" icon="detect" disabled={busy} onClick={() => onDetect(ids)}>
          Detect on selection
        </Button>
      )}
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void nothingToReport()}>
        Nothing to report
      </Button>
      <Button size="sm" variant="danger" icon="trash" disabled={busy} onClick={() => setConfirming(true)}>
        Delete
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSelectionChange(EMPTY_SELECTION)}>
        Clear
      </Button>
      <Dialog
        open={confirming}
        title={`Delete ${plural(ids.length, "image")}?`}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              {`Delete ${plural(ids.length, "image")}`}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Their annotations and findings go with them. The original files in the source folder are not
          touched.
        </p>
      </Dialog>
    </GlassPanel>
  );
}
