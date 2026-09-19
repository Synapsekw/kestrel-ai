import { useCallback, useState } from "react";
import type { Model, Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { deleteModel, fetchModel } from "@/api/models";
import { patchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { RevealButton } from "@/exports/RevealButton";
import { ExportButtons } from "./ExportButtons";
import { ModelArtifacts } from "./ModelArtifacts";
import { classMapping, formatLocalDate, formatMetric, kindLabel } from "./modelLabels";
import type { DatasetNames } from "./useDatasetNames";

export interface ModelDetailProps {
  projectId: string;
  model: Model;
  project: Project;
  datasetNames: DatasetNames;
  onProjectSaved: (p: Project) => void;
  onChanged: (m: Model) => void;
  onDeleted: (id: string) => void;
}

const dt = "text-xs uppercase tracking-wide text-slate-500";
const dd = "text-sm";
const btn = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";
const danger = "rounded bg-red-800 px-3 py-1 text-sm hover:bg-red-700 disabled:opacity-50";

export function ModelDetail({
  projectId,
  model,
  project,
  datasetNames,
  onProjectSaved,
  onChanged,
  onDeleted,
}: ModelDetailProps) {
  const api = useApi();
  const metrics = model.metrics;
  const aliases = Object.entries(model.class_aliases);
  const mapping = classMapping(
    model.class_names,
    model.class_aliases,
    (project?.classes ?? []).map((c) => c.name),
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPreannotation = project.preannotation_model_id === model.id;

  /** A finished export changes `model.exports`; refetch the row so the parent list shows the new path. */
  const refresh = useCallback(
    () =>
      void fetchModel(api, projectId, model.id)
        .then(onChanged)
        .catch((e: unknown) => pushLog(`refresh model failed: ${messageOf(e, String(e))}`)),
    [api, projectId, model.id, onChanged],
  );

  async function setAsPreannotation() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      onProjectSaved(await patchProject(api, projectId, { preannotation_model_id: model.id }));
      setStatus("Pre-annotation model set");
    } catch (e) {
      pushLog(`set preannotation model failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not set the pre-annotation model"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteModel(api, projectId, model.id);
      onDeleted(model.id);
    } catch (e) {
      pushLog(`delete model ${model.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not delete the model"));
      setBusy(false);
    }
  }
  return (
    <section
      data-testid="model-detail"
      className="flex flex-col gap-4 rounded border border-slate-800 bg-slate-800/30 p-4"
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-medium">{model.name}</h2>
        <span className="rounded bg-slate-700 px-2 py-0.5 text-xs">{kindLabel(model.kind)}</span>
        <span className="text-xs text-slate-400">created {formatLocalDate(model.created_at)}</span>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
        <div>
          <dt className={dt}>Base weights</dt>
          <dd className={`${dd} font-mono`}>{model.base_weights ?? "–"}</dd>
        </div>
        <div>
          <dt className={dt}>Dataset</dt>
          <dd className={dd}>
            {model.dataset_id
              ? (datasetNames.names[model.dataset_id] ??
                (datasetNames.loaded ? "deleted dataset" : model.dataset_id))
              : "–"}
          </dd>
        </div>
        <div>
          <dt className={dt}>Weights</dt>
          <dd className={`${dd} flex flex-wrap items-center gap-2 font-mono`}>
            {model.weights_path}
            <RevealButton projectId={projectId} path={model.weights_path} />
          </dd>
        </div>
        <div>
          <dt className={dt}>Training job</dt>
          <dd className={`${dd} font-mono`}>{model.run_id ? model.run_id.slice(0, 8) : "–"}</dd>
        </div>
      </dl>

      {Object.keys(model.hyperparameters).length > 0 && (
        <p className="font-mono text-xs text-slate-400">{JSON.stringify(model.hyperparameters)}</p>
      )}

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Classes</h3>
        <p className="text-sm text-slate-300">{model.class_names.join(", ") || "–"}</p>
        {aliases.length > 0 && (
          <p className="text-xs text-slate-400">
            Aliases: {aliases.map(([from, to]) => `${from} → ${to}`).join(", ")}
          </p>
        )}
        {project && (
          <p data-testid="class-mapping" className="text-xs text-slate-400">
            {mapping.mapped.length} of {model.class_names.length}{" "}
            {mapping.mapped.length === 1 ? "classes maps" : "classes map"} to this project
            {mapping.mapped.length > 0 &&
              `: ${mapping.mapped.map((m) => (m.from === m.to ? m.to : `${m.from} → ${m.to}`)).join(", ")}`}
            .{mapping.ignored > 0 && ` Detections of the other ${mapping.ignored} are dropped.`}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Metrics</h3>
        {metrics ? (
          <>
            <dl className="grid grid-cols-4 gap-2">
              {(
                [
                  ["mAP50", metrics.map50],
                  ["mAP50-95", metrics.map50_95],
                  ["Precision", metrics.precision],
                  ["Recall", metrics.recall],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded bg-slate-900 px-3 py-2">
                  <dt className={dt}>{label}</dt>
                  <dd className="text-lg tabular-nums">{formatMetric(value)}</dd>
                </div>
              ))}
            </dl>
            <table data-testid="class-metrics" className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase text-slate-500">
                  <th className="px-2 py-1 font-medium">Class</th>
                  <th className="px-2 py-1 font-medium">mAP50</th>
                  <th className="px-2 py-1 font-medium">mAP50-95</th>
                  <th className="px-2 py-1 font-medium">Precision</th>
                  <th className="px-2 py-1 font-medium">Recall</th>
                </tr>
              </thead>
              <tbody>
                {metrics.per_class.map((c) => (
                  <tr key={c.class_name} className="border-t border-slate-800">
                    <td className="px-2 py-1">{c.class_name}</td>
                    <td className="px-2 py-1 tabular-nums">{formatMetric(c.map50)}</td>
                    <td className="px-2 py-1 tabular-nums">{formatMetric(c.map50_95)}</td>
                    <td className="px-2 py-1 tabular-nums">{formatMetric(c.precision)}</td>
                    <td className="px-2 py-1 tabular-nums">{formatMetric(c.recall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm text-slate-400">
            No metrics: imported weights are not evaluated on a project dataset.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Training artifacts</h3>
        <ModelArtifacts projectId={projectId} model={model} />
      </div>

      <ExportButtons projectId={projectId} model={model} onFinished={refresh} />

      <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {isPreannotation ? (
            <span className="rounded bg-emerald-800 px-2 py-0.5 text-xs text-emerald-100">
              Pre-annotation model
            </span>
          ) : (
            <button type="button" className={btn} onClick={() => void setAsPreannotation()} disabled={busy}>
              Use as pre-annotation model
            </button>
          )}
          {!confirming && (
            <button type="button" className={danger} onClick={() => setConfirming(true)} disabled={busy}>
              Delete model
            </button>
          )}
          {status && (
            <span role="status" className="text-xs text-emerald-300">
              {status}
            </span>
          )}
        </div>
        {confirming && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Delete {model.name}? Its weights and exports are removed; boxes keep their provenance.
            </span>
            <button type="button" className={danger} onClick={() => void remove()} disabled={busy}>
              Delete permanently
            </button>
            <button type="button" className={btn} onClick={() => setConfirming(false)} disabled={busy}>
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
    </section>
  );
}
