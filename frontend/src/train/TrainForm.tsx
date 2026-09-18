import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Dataset, Model, TrainRequest } from "@contract/client";
import { kindLabel } from "@/models/modelLabels";
import {
  DEFAULT_TRAIN_FORM,
  suggestName,
  toTrainRequest,
  validateTrainForm,
  type TrainForm as Form,
} from "./trainModel";

interface Props {
  projectId: string;
  datasets: Dataset[];
  models: Model[];
  datasetsUnavailable: boolean;
  modelsUnavailable: boolean;
  busy: boolean;
  onStart: (req: TrainRequest) => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm disabled:opacity-50";
const label = "flex flex-col gap-1 text-xs text-slate-400";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";

/** Spec section 7 parameters. Preselects when the lists arrive (or change) without touching what the user typed. */
export function TrainForm({
  projectId,
  datasets,
  models,
  datasetsUnavailable,
  modelsUnavailable,
  busy,
  onStart,
}: Props) {
  const [form, setForm] = useState<Form>(() => ({
    ...DEFAULT_TRAIN_FORM,
    datasetId: datasets[0]?.id ?? "",
    baseModelId: models[0]?.id ?? "",
    name: suggestName(datasets[0], models[0]),
  }));
  const [error, setError] = useState<string | null>(null);
  const dataset = datasets.find((d) => d.id === form.datasetId);

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
    if (!problem) onStart(toTrainRequest(form));
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className={label}>
          Dataset
          <select
            aria-label="Dataset"
            value={form.datasetId}
            onChange={(e) => chooseDataset(e.target.value)}
            disabled={datasetsUnavailable}
            className={input}
          >
            <option value="">Choose a dataset</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.image_count} images, {d.split_method})
              </option>
            ))}
          </select>
          <span>
            {dataset
              ? `${dataset.image_count} images: ${dataset.train_count} train / ${dataset.val_count} val, ${dataset.classes.length} classes`
              : "Datasets are frozen from labeled images."}{" "}
            <Link to={`/p/${projectId}/data`} className="text-orange-300 hover:underline">
              Create dataset
            </Link>{" "}
            (select images in the Data Manager and use Add to dataset).
          </span>
        </label>
        <label className={label}>
          Base model
          <select
            aria-label="Base model"
            value={form.baseModelId}
            onChange={(e) => chooseModel(e.target.value)}
            disabled={modelsUnavailable}
            className={input}
          >
            <option value="">Choose a base model</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({kindLabel(m.kind)})
              </option>
            ))}
          </select>
          <span>Any registry model, including imported COCO weights.</span>
        </label>
      </div>
      {datasetsUnavailable && (
        <p role="note" className="text-xs text-slate-400">
          Datasets are not available yet (they arrive with the dataset backend).
        </p>
      )}
      {modelsUnavailable && (
        <p role="note" className="text-xs text-slate-400">
          The model registry is not available yet (it arrives with the training backend).
        </p>
      )}
      <label className={label}>
        Model name
        <input
          aria-label="Model name"
          value={form.name}
          onChange={(e) => patch({ name: e.target.value })}
          className={input}
        />
      </label>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className={label}>
          Epochs
          <input
            aria-label="Epochs"
            type="number"
            min={1}
            max={1000}
            value={form.epochs}
            onChange={(e) => patch({ epochs: e.target.value })}
            className={input}
          />
        </label>
        <label className={label}>
          Image size
          <input
            aria-label="Image size"
            type="number"
            min={320}
            max={4096}
            step={32}
            value={form.imgsz}
            onChange={(e) => patch({ imgsz: e.target.value })}
            className={input}
          />
        </label>
        <label className={label}>
          Batch size
          <input
            aria-label="Batch size"
            type="number"
            min={1}
            value={form.batch}
            disabled={form.batchAuto}
            onChange={(e) => patch({ batch: e.target.value })}
            className={input}
          />
          <span className="flex items-center gap-1">
            <input
              aria-label="Automatic batch size"
              type="checkbox"
              checked={form.batchAuto}
              onChange={(e) => patch({ batchAuto: e.target.checked })}
            />
            auto
          </span>
        </label>
        <label className={label}>
          Patience
          <input
            aria-label="Patience"
            type="number"
            min={0}
            value={form.patience}
            onChange={(e) => patch({ patience: e.target.value })}
            className={input}
          />
        </label>
        <label className={label}>
          Augmentation
          <select
            aria-label="Augmentation"
            value={form.augmentation}
            onChange={(e) => patch({ augmentation: e.target.value as Form["augmentation"] })}
            className={input}
          >
            <option value="default">default</option>
            <option value="aerial">aerial (flips both axes, 90 degree rotations)</option>
          </select>
        </label>
        <label className={label}>
          Device
          <select
            aria-label="Device"
            value={form.device}
            onChange={(e) => patch({ device: e.target.value })}
            className={input}
          >
            <option value="0">GPU 0</option>
            <option value="cpu">CPU</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <button type="submit" className={`${primary} self-start`} disabled={busy}>
        Start training
      </button>
    </form>
  );
}
