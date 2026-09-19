import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Dataset, Model, TrainRequest } from "@contract/client";
import { kindLabel } from "@/models/modelLabels";
import { Alert, Button, Checkbox, Disclosure, Field, Input, Select } from "@/ui";
import {
  DEFAULT_TRAIN_FORM,
  suggestName,
  toTrainRequest,
  trainAdvice,
  validateTrainForm,
  type TrainForm as Form,
} from "./trainModel";

interface Props {
  projectId: string;
  datasets: Dataset[];
  models: Model[];
  datasetsUnavailable: boolean;
  modelsUnavailable: boolean;
  modelsLoading: boolean;
  modelsError: string | null;
  busy: boolean;
  onStart: (req: TrainRequest) => void;
  /** Preselects a dataset (the Datasets screen's "Train on this dataset" link, `?dataset=`). */
  initialDatasetId?: string;
}

const link = "font-medium text-accent hover:underline";

/** The settings folded under "More options" that differ from their defaults, as lower-case names. */
function changedOptions(f: Form): string[] {
  const d = DEFAULT_TRAIN_FORM;
  const changed: string[] = [];
  if (f.epochs !== d.epochs) changed.push("epochs");
  if (f.imgsz !== d.imgsz) changed.push("image size");
  if (f.batchAuto !== d.batchAuto || (!f.batchAuto && f.batch !== d.batch)) changed.push("batch size");
  if (f.patience !== d.patience) changed.push("patience");
  if (f.augmentation !== d.augmentation) changed.push("augmentation");
  if (f.device !== d.device) changed.push("device");
  return changed;
}

/** Spec section 7 parameters. Preselects when the lists arrive (or change) without touching what the user typed. */
export function TrainForm({
  projectId,
  datasets,
  models,
  datasetsUnavailable,
  modelsUnavailable,
  modelsLoading,
  modelsError,
  busy,
  onStart,
  initialDatasetId,
}: Props) {
  const id = useId();
  const [form, setForm] = useState<Form>(() => {
    const datasetId = initialDatasetId ?? datasets[0]?.id ?? "";
    const dataset = datasets.find((d) => d.id === datasetId) ?? datasets[0];
    return {
      ...DEFAULT_TRAIN_FORM,
      datasetId,
      baseModelId: models[0]?.id ?? "",
      name: suggestName(dataset, models[0]),
    };
  });
  const [error, setError] = useState<string | null>(null);
  const changed = changedOptions(form);
  // Closed by default; open whenever a folded setting is not at its default, so nothing is hidden by surprise.
  const [moreOpen, setMoreOpen] = useState(() => changed.length > 0);
  const dataset = datasets.find((d) => d.id === form.datasetId);
  const advice = trainAdvice(dataset, form);

  // The lists load after mount and change again when a training job registers a model. Fill only
  // the pickers that are still empty and a name the user has not edited; everything typed survives.
  const lastSuggested = useRef(form.name);
  useEffect(() => {
    setForm((f) => {
      const datasetId = f.datasetId || (datasets[0]?.id ?? "");
      const baseModelId = f.baseModelId || (models[0]?.id ?? "");
      const suggested = suggestName(
        datasets.find((d) => d.id === datasetId),
        models.find((m) => m.id === baseModelId),
      );
      const name = f.name === "" || f.name === lastSuggested.current ? suggested : f.name;
      lastSuggested.current = suggested;
      if (datasetId === f.datasetId && baseModelId === f.baseModelId && name === f.name) return f;
      return { ...f, datasetId, baseModelId, name };
    });
  }, [datasets, models]);

  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  /** Keeps the suggested name in step with the pickers until the user edits it. */
  function chooseDataset(datasetId: string) {
    setForm((f) => {
      const base = models.find((m) => m.id === f.baseModelId);
      const suggested = suggestName(
        datasets.find((d) => d.id === f.datasetId),
        base,
      );
      const name =
        f.name === suggested
          ? suggestName(
              datasets.find((d) => d.id === datasetId),
              base,
            )
          : f.name;
      return { ...f, datasetId, name };
    });
  }

  function chooseModel(baseModelId: string) {
    setForm((f) => {
      const current = datasets.find((d) => d.id === f.datasetId);
      const suggested = suggestName(
        current,
        models.find((m) => m.id === f.baseModelId),
      );
      const name =
        f.name === suggested
          ? suggestName(
              current,
              models.find((m) => m.id === baseModelId),
            )
          : f.name;
      return { ...f, baseModelId, name };
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validateTrainForm(form);
    setError(problem);
    // A folded setting can only be invalid once it was changed: show it next to the message.
    if (problem && changed.length > 0) setMoreOpen(true);
    if (!problem) onStart(toTrainRequest(form));
  }

  const datasetHint = (
    <>
      {dataset
        ? `${dataset.image_count} images: ${dataset.train_count} train / ${dataset.val_count} val, ${dataset.classes.length} classes.`
        : "Datasets are frozen from labeled images."}{" "}
      <Link to={`/p/${projectId}/datasets`} className={link}>
        Create dataset
      </Link>
      , or select images on the Images screen and use Add to dataset.
    </>
  );

  const modelHint =
    models.length > 0
      ? "Any registry model, including imported COCO weights."
      : !modelsLoading &&
        !modelsUnavailable &&
        !modelsError && (
          <>
            No models yet.{" "}
            <Link to={`/p/${projectId}/models`} className={link}>
              Add a starter model
            </Link>{" "}
            to get started.
          </>
        );

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Dataset" htmlFor={`${id}-dataset`} hint={datasetHint}>
          <Select
            id={`${id}-dataset`}
            value={form.datasetId}
            onChange={(e) => chooseDataset(e.target.value)}
            disabled={datasetsUnavailable}
          >
            <option value="">Choose a dataset</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.image_count} images, {d.split_method})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Base model" htmlFor={`${id}-model`} hint={modelHint || undefined}>
          <Select
            id={`${id}-model`}
            value={form.baseModelId}
            onChange={(e) => chooseModel(e.target.value)}
            disabled={modelsUnavailable}
          >
            <option value="">Choose a base model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({kindLabel(m.kind)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Model name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} value={form.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
      </div>
      {datasetsUnavailable && (
        <div role="note">
          <Alert tone="info">Datasets are not available yet (they arrive with the dataset backend).</Alert>
        </div>
      )}
      {modelsUnavailable && (
        <div role="note">
          <Alert tone="info">
            The model registry is not available yet (it arrives with the training backend).
          </Alert>
        </div>
      )}
      <Disclosure
        open={moreOpen}
        onOpenChange={setMoreOpen}
        summary={!moreOpen && changed.length > 0 ? `Changed: ${changed.join(", ")}` : undefined}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field
            label="Epochs"
            htmlFor={`${id}-epochs`}
            hint="Passes over the training images. 50 to 100 is usual; 3 is only a smoke test."
          >
            <Input
              id={`${id}-epochs`}
              type="number"
              min={1}
              max={1000}
              value={form.epochs}
              onChange={(e) => patch({ epochs: e.target.value })}
            />
          </Field>
          <Field
            label="Image size"
            htmlFor={`${id}-imgsz`}
            hint="Pixels on the long side during training. 1280 keeps small machines visible; 640 is about four times faster."
          >
            <Input
              id={`${id}-imgsz`}
              type="number"
              min={320}
              max={4096}
              step={32}
              value={form.imgsz}
              onChange={(e) => patch({ imgsz: e.target.value })}
            />
          </Field>
          <Field
            label="Batch size"
            htmlFor={`${id}-batch`}
            hint="Images per step. Automatic picks what fits in the GPU's memory."
          >
            <div className="flex items-center gap-3">
              <Input
                id={`${id}-batch`}
                type="number"
                min={1}
                value={form.batch}
                disabled={form.batchAuto}
                onChange={(e) => patch({ batch: e.target.value })}
                className="min-w-0 flex-1"
              />
              <Checkbox
                aria-label="Automatic batch size"
                label="Automatic"
                checked={form.batchAuto}
                onChange={(e) => patch({ batchAuto: e.target.checked })}
                className="shrink-0"
              />
            </div>
          </Field>
          <Field
            label="Patience"
            htmlFor={`${id}-patience`}
            hint="Stops early after this many epochs without improvement. 0 never stops early."
          >
            <Input
              id={`${id}-patience`}
              type="number"
              min={0}
              value={form.patience}
              onChange={(e) => patch({ patience: e.target.value })}
            />
          </Field>
          <Field label="Augmentation" htmlFor={`${id}-augmentation`}>
            <Select
              id={`${id}-augmentation`}
              value={form.augmentation}
              onChange={(e) => patch({ augmentation: e.target.value as Form["augmentation"] })}
            >
              <option value="default">Default</option>
              <option value="aerial">Aerial (flips both axes, 90 degree rotations)</option>
            </Select>
          </Field>
          <Field label="Device" htmlFor={`${id}-device`}>
            <Select
              id={`${id}-device`}
              value={form.device}
              onChange={(e) => patch({ device: e.target.value })}
            >
              <option value="0">GPU 0</option>
              <option value="cpu">CPU</option>
            </Select>
          </Field>
        </div>
      </Disclosure>
      {advice.length > 0 && (
        <Alert tone="warn" testId="train-advice">
          <ul className="flex flex-col gap-1">
            {advice.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" variant="primary" icon="play" loading={busy} className="self-start">
        Start training
      </Button>
    </form>
  );
}
