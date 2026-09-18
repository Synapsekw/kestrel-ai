import type { Model, Project } from "@contract/client";
import { ModelArtifacts } from "./ModelArtifacts";
import { formatDate, formatMetric, kindLabel } from "./modelLabels";

export interface ModelDetailProps {
  projectId: string;
  model: Model;
  project: Project;
  datasetNames: Record<string, string>;
  onProjectSaved: (p: Project) => void;
  onChanged: (m: Model) => void;
  onDeleted: (id: string) => void;
}

const dt = "text-xs uppercase tracking-wide text-slate-500";
const dd = "text-sm";

/** Task 7 adds the actions area; it destructures the remaining props (project and the callbacks). */
export function ModelDetail(props: ModelDetailProps) {
  const { projectId, model, datasetNames } = props;
  const metrics = model.metrics;
  const aliases = Object.entries(model.class_aliases);
  return (
    <section
      data-testid="model-detail"
      className="flex flex-col gap-4 rounded border border-slate-800 bg-slate-800/30 p-4"
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-medium">{model.name}</h2>
        <span className="rounded bg-slate-700 px-2 py-0.5 text-xs">{kindLabel(model.kind)}</span>
        <span className="text-xs text-slate-400">created {formatDate(model.created_at)}</span>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
        <div>
          <dt className={dt}>Base weights</dt>
          <dd className={`${dd} font-mono`}>{model.base_weights ?? "–"}</dd>
        </div>
        <div>
          <dt className={dt}>Dataset</dt>
          <dd className={dd}>
            {model.dataset_id ? (datasetNames[model.dataset_id] ?? model.dataset_id) : "–"}
          </dd>
        </div>
        <div>
          <dt className={dt}>Weights</dt>
          <dd className={`${dd} font-mono`}>{model.weights_path}</dd>
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

      {/* actions (Task 7): exports, pre-annotation, delete */}
    </section>
  );
}
