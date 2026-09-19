import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Dataset, Model, TrainRequest } from "@contract/client";
import { kindLabel } from "@/models/modelLabels";
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
  modelsLoading,
  modelsError,
  busy,
  onStart,
  initialDatasetId,
}: Props) {
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
  const dataset = datasets.find((d) => d.id === form.datasetId);
  const advice = trainAdvice(dataset, form);

  // The lists load after mount and change again when a training job registers a model. Fill only
  // the pickers that are still empty and a name the user has not edited; everything typed survives.
  const lastSuggested = useRef(form.name);
  useEffect(() => {
    setForm((f) => {
      // A datasetId survives while the list is still empty (still loading); once a non-empty list
      // arrives, an id that is not in it (an unknown ?dataset=, or one since deleted) falls back to
      // the first dataset instead of staying stuck on a value the picker can never show (I5).
      const datasetId =
        f.datasetId && (datasets.length === 0 || datasets.some((d) => d.id === f.datasetId))
          ? f.datasetId
          : (datasets[0]?.id ?? "");
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
            <Link to={`/p/${projectId}/datasets`} className="text-orange-300 hover:underline">
              Create dataset
            </Link>{" "}
            (or select images in the Data Manager and use Add to dataset).
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
          <span>
            {models.length > 0
              ? "Any registry model, including imported COCO weights."
              : !modelsLoading &&
                !modelsUnavailable &&
                !modelsError && (
                  <>
                    No models yet.{" "}
                    <Link to={`/p/${projectId}/models`} className="text-orange-300 hover:underline">
                      Add a starter model
                    </Link>{" "}
                    to get started.
                  </>
                )}
          </span>
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
          <span>Passes over the training images. 50 to 100 is usual; 3 is only a smoke test.</span>
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
          <span>
            Pixels on the long side during training. 1280 keeps small machines visible; 640 is about four
            times faster.
          </span>
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
          <span>Stops early after this many epochs without improvement. 0 never stops early.</span>
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
      {advice.length > 0 && (
        <ul
          data-testid="train-advice"
          className="flex flex-col gap-1 rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-200"
        >
          {advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
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
