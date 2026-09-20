import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Dataset } from "@contract/client";
import { useApi } from "@/api/client";
import type { SplitMethod } from "@/api/datasets";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { splitAdvice } from "@/datasets/splitAdvice";
import { JobCard } from "@/jobs/JobCard";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Disclosure, Field, Input, Select, buttonClass } from "@/ui";
import { addImagesToDataset } from "./bulkActions";

interface Props {
  projectId: string;
  imageIds: string[];
  /** How many of the selected images have an accepted or edited box. */
  labeledCount: number;
  /** How many of the selected images are marked empty (E4): shown as negatives, not a defect. */
  emptyCount: number;
  /** How many are neither: they would freeze in with no boxes, as if they were empty. */
  unlabeledCount: number;
  onClose: () => void;
}

/** Spec section 5 split options (by_group default, val fraction 0.2, seed 42); the job shows inline. */
export function AddToDatasetDialog({
  projectId,
  imageIds,
  labeledCount,
  emptyCount,
  unlabeledCount,
  onClose,
}: Props) {
  const api = useApi();
  const id = useId();
  const [name, setName] = useState("");
  const [split, setSplit] = useState<SplitMethod>("by_group");
  const [valFraction, setValFraction] = useState("0.2");
  const [seed, setSeed] = useState("42");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const n = imageIds.length;
  const job = useJobsStore((s) => (jobId ? s.jobs[jobId] : undefined));
  // The creation response already carries the dataset's final counts (freeze() computes the split
  // before the job writes files), so no refetch is needed once the job succeeds (M7). A failed job
  // discards the row, so the advice and "Open dataset" only show once the job has succeeded.
  const [createdDataset, setCreatedDataset] = useState<Dataset | null>(null);

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
      setCreatedDataset(created.dataset);
    } catch (err) {
      pushLog(`add to dataset failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not create the dataset"));
    } finally {
      setBusy(false);
    }
  }

  const dataset = job?.state === "succeeded" ? createdDataset : null;
  const advice = dataset ? splitAdvice(dataset) : null;

  return (
    <Dialog
      open
      title="Add to dataset"
      onClose={() => {
        if (!busy) onClose();
      }}
      onSubmit={jobId === null ? (e) => void submit(e) : undefined}
      footer={
        jobId === null ? (
          <>
            <Button onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Create dataset
            </Button>
          </>
        ) : (
          <>
            {dataset && (
              <Link
                to={`/p/${projectId}/datasets?dataset=${dataset.id}`}
                className={buttonClass("secondary", "md")}
              >
                Open dataset
              </Link>
            )}
            <Link
              to={`/p/${projectId}/train${dataset ? `?dataset=${dataset.id}` : ""}`}
              className={buttonClass("primary", "md")}
            >
              Train on it
            </Link>
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed">
          Freeze {n} {n === 1 ? "image" : "images"} into a new dataset (immutable after creation):{" "}
          {labeledCount} with accepted boxes, {emptyCount} marked empty (negative examples).
        </p>
        {unlabeledCount > 0 && (
          <Alert tone="warn">
            {unlabeledCount === 1
              ? "1 selected image is not labeled yet. It would be written without boxes, as if it were empty. Deselect it unless it really shows no machinery."
              : `${unlabeledCount} selected images are not labeled yet. They would be written without boxes, as if they were empty. Deselect them unless they really show no machinery.`}
          </Alert>
        )}
        {jobId === null ? (
          <>
            <Field
              label="Dataset name"
              htmlFor={`${id}-name`}
              hint="Letters, digits, dot, dash and underscore; no spaces."
            >
              <Input
                id={`${id}-name`}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="font-mono"
              />
            </Field>
            <Disclosure label="Split options">
              <div className="grid grid-cols-1 gap-4 rounded-lg border border-line bg-ground p-4 sm:grid-cols-3">
                <Field label="Split method" htmlFor={`${id}-split`}>
                  <Select
                    id={`${id}-split`}
                    value={split}
                    onChange={(e) => setSplit(e.target.value as SplitMethod)}
                  >
                    <option value="by_group">By flight</option>
                    <option value="by_tile">By tile</option>
                    <option value="random">Random</option>
                  </Select>
                </Field>
                <Field label="Validation fraction" htmlFor={`${id}-val`}>
                  <Input
                    id={`${id}-val`}
                    type="number"
                    min={0.05}
                    max={0.5}
                    step={0.05}
                    value={valFraction}
                    onChange={(e) => setValFraction(e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
                <Field label="Seed" htmlFor={`${id}-seed`}>
                  <Input
                    id={`${id}-seed`}
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
              </div>
            </Disclosure>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            {job ? (
              <JobCard projectId={projectId} job={job} />
            ) : (
              <p className="text-sm text-muted">Job queued</p>
            )}
            {/* A note, not an alert: the split worked, it just landed off the requested fraction. */}
            {advice && (
              <div role="note">
                <Alert tone="warn" role="status">
                  {advice}
                </Alert>
              </div>
            )}
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
