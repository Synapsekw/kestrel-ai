import { useState, type FormEvent } from "react";
import { useApi } from "@/api/client";
import { createDataset, type SplitMethod } from "@/api/datasets";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { JobCard } from "@/jobs/JobCard";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Disclosure, Field, Input, Select } from "@/ui";

interface Props {
  projectId: string;
  onClose: () => void;
}

/**
 * Creates a dataset from every labeled image (accepted boxes or marked empty): the contract
 * defaults the selection when `image_ids` is left out (spec section 5).
 */
export function NewDatasetForm({ projectId, onClose }: Props) {
  const api = useApi();
  const [name, setName] = useState("");
  const [split, setSplit] = useState<SplitMethod>("by_group");
  const [valFraction, setValFraction] = useState("0.2");
  const [seed, setSeed] = useState("42");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const { job } = useTrackedJob(projectId, jobId);

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
      const created = await createDataset(api, projectId, {
        name: name.trim(),
        split_method: split,
        val_fraction: fraction,
        seed: seedValue,
      });
      useJobsStore.getState().upsert(created.job);
      setJobId(created.job.id);
    } catch (err) {
      pushLog(`create dataset failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not create the dataset"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="New dataset"
      onSubmit={(e) => void submit(e)}
      noValidate
      className="flex flex-col gap-4 rounded-lg border border-line bg-panel p-5 animate-reveal motion-reduce:animate-none"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">New dataset</h2>
        <p className="text-sm text-muted">
          Freeze every labeled image (accepted boxes and images marked empty) into a new dataset, immutable
          once created.
        </p>
      </div>
      {jobId === null ? (
        <>
          <Field
            label="Dataset name"
            htmlFor="new-dataset-name"
            hint="Letters, digits, dot, dash and underscore; no spaces."
            className="max-w-sm"
          >
            <Input
              id="new-dataset-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="v2"
            />
          </Field>
          <Disclosure label="Split options">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Split method" htmlFor="new-dataset-split">
                <Select
                  id="new-dataset-split"
                  value={split}
                  onChange={(e) => setSplit(e.target.value as SplitMethod)}
                >
                  <option value="by_group">by group</option>
                  <option value="by_tile">by tile</option>
                  <option value="random">random</option>
                </Select>
              </Field>
              <Field label="Validation fraction" htmlFor="new-dataset-fraction">
                <Input
                  id="new-dataset-fraction"
                  type="number"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={valFraction}
                  onChange={(e) => setValFraction(e.target.value)}
                  className="tabular-nums"
                />
              </Field>
              <Field label="Seed" htmlFor="new-dataset-seed">
                <Input
                  id="new-dataset-seed"
                  type="number"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  className="tabular-nums"
                />
              </Field>
            </div>
          </Disclosure>
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              Create dataset
            </Button>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {job ? (
            <JobCard projectId={projectId} job={job} />
          ) : (
            <p className="text-sm text-muted">Job queued…</p>
          )}
          <Button className="self-start" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
