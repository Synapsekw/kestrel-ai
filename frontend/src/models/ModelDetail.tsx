import { useCallback, useState, type ReactNode } from "react";
import type { Model, Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { deleteModel, fetchModel } from "@/api/models";
import { patchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Pill } from "@/ui";
import { ExportButtons } from "./ExportButtons";
import { ModelArtifacts } from "./ModelArtifacts";
import { classMapping, formatLocalDate, formatMetric, kindLabel } from "./modelLabels";

export interface ModelDetailProps {
  projectId: string;
  model: Model;
  project: Project;
  datasetNames: Record<string, string>;
  onProjectSaved: (p: Project) => void;
  onChanged: (m: Model) => void;
  onDeleted: (id: string) => void;
}

/** One row of the details list: muted term on the left, value on the right. */
function Row({ term, children, mono }: { term: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0">
      <dt className="shrink-0 text-muted">{term}</dt>
      <dd className={mono ? "min-w-0 truncate text-right font-mono text-[13px]" : "min-w-0 text-right"}>
        {children}
      </dd>
    </div>
  );
}

const th = "h-8 border-b border-line px-3 font-medium";

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
    <section data-testid="model-detail" className="flex flex-col gap-6 border-t border-line pt-6">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{model.name}</h2>
        <Pill tone={model.kind === "trained" ? "ok" : "neutral"} size="sm">
          {kindLabel(model.kind)}
        </Pill>
        <span className="text-xs tabular-nums text-muted">created {formatLocalDate(model.created_at)}</span>
      </header>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <section className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold">Details</h3>
          <dl className="flex flex-col">
            <Row term="Base weights" mono>
              {model.base_weights ?? "–"}
            </Row>
            <Row term="Dataset">
              {model.dataset_id ? (datasetNames[model.dataset_id] ?? model.dataset_id) : "–"}
            </Row>
            <Row term="Weights" mono>
              <span title={model.weights_path}>{model.weights_path}</span>
            </Row>
            <Row term="Training job" mono>
              {model.run_id ? model.run_id.slice(0, 8) : "–"}
            </Row>
            {Object.keys(model.hyperparameters).length > 0 && (
              <Row term="Settings" mono>
                {JSON.stringify(model.hyperparameters)}
              </Row>
            )}
          </dl>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Classes</h3>
          <p className="text-sm">{model.class_names.join(", ") || "–"}</p>
          {aliases.length > 0 && (
            <p className="text-xs text-muted">
              Aliases: {aliases.map(([from, to]) => `${from} → ${to}`).join(", ")}
            </p>
          )}
          {project && (
            <p data-testid="class-mapping" className="text-xs leading-relaxed text-muted">
              {mapping.mapped.length} of {model.class_names.length}{" "}
              {mapping.mapped.length === 1 ? "classes maps" : "classes map"} to this project
              {mapping.mapped.length > 0 &&
                `: ${mapping.mapped.map((m) => (m.from === m.to ? m.to : `${m.from} → ${m.to}`)).join(", ")}`}
              .{mapping.ignored > 0 && ` Detections of the other ${mapping.ignored} are dropped.`}
            </p>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Metrics</h3>
        {metrics ? (
          <>
            <dl className="flex flex-wrap gap-x-8 gap-y-2">
              {(
                [
                  ["mAP50", metrics.map50],
                  ["mAP50-95", metrics.map50_95],
                  ["Precision", metrics.precision],
                  ["Recall", metrics.recall],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex flex-col">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="text-base font-semibold tabular-nums">{formatMetric(value)}</dd>
                </div>
              ))}
            </dl>
            <div className="overflow-x-auto rounded-lg border border-line bg-panel">
              <table data-testid="class-metrics" className="w-full border-collapse text-left text-[13px]">
                <thead>
                  <tr className="text-xs text-muted">
                    <th className={th}>Class</th>
                    <th className={`${th} text-right`}>mAP50</th>
                    <th className={`${th} text-right`}>mAP50-95</th>
                    <th className={`${th} text-right`}>Precision</th>
                    <th className={`${th} text-right`}>Recall</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.per_class.map((c) => (
                    <tr key={c.class_name} className="h-9 border-b border-line last:border-b-0">
                      <td className="px-3">{c.class_name}</td>
                      <td className="px-3 text-right tabular-nums">{formatMetric(c.map50)}</td>
                      <td className="px-3 text-right tabular-nums">{formatMetric(c.map50_95)}</td>
                      <td className="px-3 text-right tabular-nums">{formatMetric(c.precision)}</td>
                      <td className="px-3 text-right tabular-nums">{formatMetric(c.recall)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted">
            No metrics: imported weights are not evaluated on a project dataset.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Training artifacts</h3>
        <ModelArtifacts projectId={projectId} model={model} />
      </section>

      <ExportButtons projectId={projectId} model={model} onFinished={refresh} />

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {isPreannotation ? (
            <Pill tone="ok" dot>
              Pre-annotation model
            </Pill>
          ) : (
            <Button onClick={() => void setAsPreannotation()} disabled={busy}>
              Use as pre-annotation model
            </Button>
          )}
          {!confirming && (
            <Button variant="danger" icon="trash" onClick={() => setConfirming(true)} disabled={busy}>
              Delete model
            </Button>
          )}
          {status && (
            <span role="status" className="text-sm text-ok">
              {status}
            </span>
          )}
        </div>
        {confirming && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              Delete {model.name}? Its weights and exports are removed; boxes keep their provenance.
            </span>
            <Button variant="danger" onClick={() => void remove()} disabled={busy}>
              Delete permanently
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </section>
  );
}
