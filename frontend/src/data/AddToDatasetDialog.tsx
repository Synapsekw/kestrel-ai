import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@/api/client";
import type { SplitMethod } from "@/api/datasets";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { JobCard } from "@/jobs/JobCard";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";
import { addImagesToDataset } from "./bulkActions";

interface Props {
  projectId: string;
  imageIds: string[];
  onClose: () => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const label = "flex flex-col gap-1 text-xs text-slate-400";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";
const secondary = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

/** Spec section 5 split options (by_group default, val fraction 0.2, seed 42); the job shows inline. */
export function AddToDatasetDialog({ projectId, imageIds, onClose }: Props) {
  const api = useApi();
  const [name, setName] = useState("");
  const [split, setSplit] = useState<SplitMethod>("by_group");
  const [valFraction, setValFraction] = useState("0.2");
  const [seed, setSeed] = useState("42");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useTrackedJob(projectId, jobId);
  const n = imageIds.length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const fraction = Number(valFraction);
    const seedValue = Number(seed);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      setError("The name may only contain letters, digits, dot, dash and underscore (no spaces).");
      return;
    }
    if (!(fraction >= 0.05 && fraction <= 0.5)) {
      setError("Validation fraction must be between 0.05 and 0.5.");
      return;
    }
    if (!Number.isInteger(seedValue)) {
      setError("Seed must be a whole number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await addImagesToDataset(api, projectId, imageIds, {
        name: name.trim(),
        split_method: split,
        val_fraction: fraction,
        seed: seedValue,
      });
      useJobsStore.getState().upsert(created.job);
      setJobId(created.job.id);
    } catch (err) {
      pushLog(`add to dataset failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not create the dataset"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      role="dialog"
      aria-label="Add to dataset"
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3 rounded border border-slate-700 bg-slate-800/60 p-3"
    >
      <p className="text-sm">
        Freeze the accepted boxes of {n} {n === 1 ? "image" : "images"} into a new dataset (immutable after
        creation).
      </p>
      {jobId === null ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className={label}>
            Name
            <input
              aria-label="Dataset name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={input}
            />
            <span className="text-slate-500">Letters, digits, dot, dash and underscore; no spaces.</span>
          </label>
          <label className={label}>
            Split
            <select
              aria-label="Split method"
              value={split}
              onChange={(e) => setSplit(e.target.value as SplitMethod)}
              className={input}
            >
              <option value="by_group">by group</option>
              <option value="by_tile">by tile</option>
              <option value="random">random</option>
            </select>
          </label>
          <label className={label}>
            Validation fraction
            <input
              aria-label="Validation fraction"
              type="number"
              min={0.05}
              max={0.5}
              step={0.05}
              value={valFraction}
              onChange={(e) => setValFraction(e.target.value)}
              className={`${input} w-20`}
            />
          </label>
          <label className={label}>
            Seed
            <input
              aria-label="Seed"
              type="number"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className={`${input} w-24`}
            />
          </label>
          <button type="submit" className={primary} disabled={busy}>
            Create dataset
          </button>
          <button type="button" className={secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {job ? (
            <JobCard projectId={projectId} job={job} />
          ) : (
            <p className="text-xs text-slate-400">Job queued…</p>
          )}
          <div className="flex items-center gap-3">
            <Link to={`/p/${projectId}/train`} className="text-sm text-orange-300 hover:underline">
              Train on it
            </Link>
            <button type="button" className={secondary} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
