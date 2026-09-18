import { useState, type FormEvent } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { useJobsStore } from "@/store/jobs";
import { addImagesToDataset, deleteImages, runModelOnImages, type DatasetOptions } from "./bulkActions";

interface Props {
  projectId: string;
  selectedIds: string[];
  preannotationModelId: string | null;
  onLabel: () => void;
  onDeleted: () => void;
  onClear: () => void;
}

const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";
const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";

export function SelectionBar({
  projectId,
  selectedIds,
  preannotationModelId,
  onLabel,
  onDeleted,
  onClear,
}: Props) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "dataset" | "confirm-delete">("idle");
  const [dataset, setDataset] = useState<DatasetOptions>({
    name: "",
    split_method: "by_group",
    val_fraction: 0.2,
  });
  const n = selectedIds.length;

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      setStatus(await fn());
      setMode("idle");
    } catch (e) {
      pushLog(`${label} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, `${label} failed`));
    } finally {
      setBusy(false);
    }
  }

  const runModel = () =>
    run("run model", async () => {
      const job = await runModelOnImages(api, projectId, selectedIds, preannotationModelId as string);
      useJobsStore.getState().upsert(job);
      return `Model run queued for ${n} images (job ${job.id.slice(0, 8)})`;
    });

  const createDataset = (e: FormEvent) => {
    e.preventDefault();
    void run("add to dataset", async () => {
      const job = await addImagesToDataset(api, projectId, selectedIds, dataset);
      useJobsStore.getState().upsert(job);
      return `Dataset ${dataset.name} queued with ${n} images (job ${job.id.slice(0, 8)})`;
    });
  };

  const confirmDelete = () =>
    run("delete images", async () => {
      const deleted = await deleteImages(api, projectId, selectedIds);
      useChangesStore.getState().bumpImages();
      onDeleted();
      return `${deleted} images deleted`;
    });

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
          onClick={() => void runModel()}
          disabled={busy || !preannotationModelId}
          title={
            preannotationModelId
              ? "Run the pre-annotation model over the selection"
              : "Choose a pre-annotation model in Settings first"
          }
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
        <form onSubmit={createDataset} className="flex flex-wrap items-end gap-2">
          <input
            aria-label="Dataset name"
            required
            pattern="[A-Za-z0-9._-]+"
            placeholder="dataset name"
            value={dataset.name}
            onChange={(e) => setDataset({ ...dataset, name: e.target.value })}
            className={input}
          />
          <select
            aria-label="Split method"
            value={dataset.split_method}
            onChange={(e) =>
              setDataset({ ...dataset, split_method: e.target.value as DatasetOptions["split_method"] })
            }
            className={input}
          >
            <option value="by_group">by group</option>
            <option value="by_tile">by tile</option>
            <option value="random">random</option>
          </select>
          <input
            aria-label="Validation fraction"
            type="number"
            min={0.05}
            max={0.5}
            step={0.05}
            value={dataset.val_fraction}
            onChange={(e) => setDataset({ ...dataset, val_fraction: Number(e.target.value) })}
            className={`${input} w-20`}
          />
          <button type="submit" className={primary} disabled={busy}>
            Create dataset
          </button>
        </form>
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
      {status && (
        <p role="status" className="text-xs text-emerald-300">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
