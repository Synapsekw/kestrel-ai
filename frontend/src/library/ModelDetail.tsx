import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { Job, LibraryModel, LibraryModelPatch, ModelUsage } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { deleteLibraryModel, fetchModelUsage, updateLibraryModel } from "@/api/library";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Field, Input, Pill, Textarea } from "@/ui";
import { formatAliases, parseAliases } from "./aliases";
import { ExportButtons } from "./ExportButtons";
import { ModelArtifacts } from "./ModelArtifacts";
import { formatLocalDate, formatMetric, originLabel, taskLabel } from "./modelLabels";

export interface ModelDetailProps {
  model: LibraryModel;
  onChanged: (m: LibraryModel) => void;
  onDeleted: (id: string) => void;
  /** An export job started here; the screen shows its progress. */
  onJobStarted: (job: Job) => void;
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

/** "Trained in <project> on <dataset>", "Imported from <file>" or a starter line; a snapshot, never a live link. */
function Provenance({ model }: { model: LibraryModel }) {
  const p = model.provenance;
  let line: ReactNode;
  if (model.origin === "trained") {
    line = (
      <>
        Trained in <em className="font-medium not-italic text-ink">{p.project_name ?? "a project"}</em>
        {p.dataset_name && (
          <>
            {" "}
            on <em className="font-medium not-italic text-ink">{p.dataset_name}</em>
          </>
        )}
        {p.base_model_name && <>, starting from {p.base_model_name}</>}.
      </>
    );
  } else if (model.origin === "imported") {
    line = p.source_file ? (
      <>
        Imported from <span className="font-mono text-[13px] text-ink">{p.source_file}</span>.
      </>
    ) : (
      "Imported from a file."
    );
  } else {
    line = "A general-purpose starter model. Train it on your own images before relying on its counts.";
  }
  return (
    <p data-testid="provenance" className="max-w-prose text-sm leading-relaxed text-muted">
      {line}
      {model.supplier && <> Supplied by {model.supplier}.</>}
    </p>
  );
}

interface Draft {
  name: string;
  notes: string;
  supplier: string;
  aliases: string;
}

function draftOf(model: LibraryModel): Draft {
  return {
    name: model.name,
    notes: model.notes,
    supplier: model.supplier ?? "",
    aliases: formatAliases(model.class_aliases),
  };
}

/** Only what changed; an untouched form sends nothing. */
function patchOf(model: LibraryModel, d: Draft): LibraryModelPatch {
  const patch: LibraryModelPatch = {};
  if (d.name.trim() !== model.name) patch.name = d.name.trim();
  if (d.notes !== model.notes) patch.notes = d.notes;
  const supplier = d.supplier.trim() || null;
  if (supplier !== model.supplier) patch.supplier = supplier;
  const aliases = parseAliases(d.aliases);
  if (JSON.stringify(aliases) !== JSON.stringify(model.class_aliases)) patch.class_aliases = aliases;
  return patch;
}

export function ModelDetail({ model, onChanged, onDeleted, onJobStarted }: ModelDetailProps) {
  const api = useApi();
  const id = useId();
  const metrics = model.metrics;
  const [draft, setDraft] = useState<Draft>(() => draftOf(model));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState<{ usage: ModelUsage } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = patchOf(model, draft);
  const dirty = Object.keys(patch).length > 0;
  const edit = (field: keyof Draft) => (value: string) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [field]: value }));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updateLibraryModel(api, model.id, patch);
      onChanged(next);
      setDraft(draftOf(next));
      setSaved(true);
    } catch (err) {
      pushLog(`update model ${model.id} failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not save the model"));
    } finally {
      setSaving(false);
    }
  }

  async function askDelete() {
    setBusy(true);
    setError(null);
    try {
      setDeleting({ usage: await fetchModelUsage(api, model.id) });
    } catch (e) {
      pushLog(`usage of model ${model.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not check which projects use the model"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteLibraryModel(api, model.id);
      onDeleted(model.id);
    } catch (e) {
      pushLog(`delete model ${model.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not delete the model"));
      setBusy(false);
    }
  }

  const users = deleting?.usage.projects ?? [];
  return (
    <section data-testid="model-detail" aria-label={model.name} className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight">{model.name}</h2>
          <Pill tone={model.origin === "trained" ? "ok" : "neutral"} size="sm">
            {originLabel(model.origin)}
          </Pill>
          <span className="text-xs text-muted">{taskLabel(model.task)}</span>
          <span className="text-xs tabular-nums text-muted">added {formatLocalDate(model.created_at)}</span>
        </div>
        <Provenance model={model} />
        {model.state === "unavailable" && (
          <Alert tone="warn">
            The weights file is missing from the library folder. Runs cannot use this model until the file is
            back.
          </Alert>
        )}
      </header>

      <form
        aria-label="Model details"
        onSubmit={(e) => void save(e)}
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
      >
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            required
            value={draft.name}
            onChange={(e) => edit("name")(e.target.value)}
          />
        </Field>
        <Field label="Supplier" htmlFor={`${id}-supplier`} hint="Who supplied the model, if anyone.">
          <Input
            id={`${id}-supplier`}
            value={draft.supplier}
            onChange={(e) => edit("supplier")(e.target.value)}
          />
        </Field>
        <Field label="Notes" htmlFor={`${id}-notes`} className="md:col-span-2">
          <Textarea
            id={`${id}-notes`}
            rows={2}
            value={draft.notes}
            onChange={(e) => edit("notes")(e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-1 md:col-span-2">
          <h3 className="text-sm font-semibold">Classes</h3>
          <p className="text-sm">{model.class_names.join(", ") || "–"}</p>
        </div>
        <Field
          label="Class aliases"
          htmlFor={`${id}-aliases`}
          hint="One per line, model class=project class. Classes without a match are left out of runs."
          className="md:col-span-2"
        >
          <Textarea
            id={`${id}-aliases`}
            rows={3}
            value={draft.aliases}
            onChange={(e) => edit("aliases")(e.target.value)}
            className="font-mono"
          />
        </Field>
        <div className="flex items-center gap-3 md:col-span-2">
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
            Save changes
          </Button>
          {saved && (
            <span role="status" className="text-sm text-ok">
              Saved
            </span>
          )}
        </div>
      </form>

      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Details</h3>
        <dl className="flex flex-col">
          <Row term="File format" mono>
            {model.format}
          </Row>
          {model.provenance.run_id && (
            <Row term="Training job" mono>
              {model.provenance.run_id.slice(0, 8)}
            </Row>
          )}
          {model.train_gsd_cm !== null && (
            <Row term="Trained at">
              <span className="tabular-nums">{model.train_gsd_cm} cm / px</span>
            </Row>
          )}
          {Object.keys(model.hyperparameters).length > 0 && (
            <Row term="Settings" mono>
              {JSON.stringify(model.hyperparameters)}
            </Row>
          )}
          <Row term="Fingerprint" mono>
            <span title={model.sha256}>{model.sha256.slice(0, 12)}</span>
          </Row>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">How well it finds objects</h3>
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
            No scores: only models trained in the app are checked against a dataset.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Training charts</h3>
        <ModelArtifacts model={model} />
      </section>

      <ExportButtons model={model} onStarted={onJobStarted} />

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        {!deleting && (
          <Button
            variant="danger"
            icon="trash"
            className="w-fit"
            loading={busy}
            onClick={() => void askDelete()}
          >
            Delete model
          </Button>
        )}
        {deleting &&
          (users.length > 0 ? (
            <Alert
              tone="warn"
              testId="delete-usage"
              title={`${users.length === 1 ? "1 project uses" : `${users.length} projects use`} this model`}
            >
              <ul className="mt-1 flex flex-col gap-0.5">
                {users.map((u) => (
                  <li key={u.project_id}>
                    <span className="font-medium">{u.name}</span>{" "}
                    <span className="text-muted">
                      {[
                        u.preannotation && "pre-annotation",
                        u.query_runs > 0 && `${u.query_runs} detection ${u.query_runs === 1 ? "run" : "runs"}`,
                        u.map_runs > 0 && `${u.map_runs} map ${u.map_runs === 1 ? "run" : "runs"}`,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Past results stay readable. New runs and pre-annotation in these projects need another model.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="danger" size="sm" loading={busy} onClick={() => void remove()}>
                  Delete anyway
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDeleting(null)}>
                  Cancel
                </Button>
              </div>
            </Alert>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>
                Delete {model.name}? Its file and copies are removed from the library. Past results stay
                readable.
              </span>
              <Button variant="danger" loading={busy} onClick={() => void remove()}>
                Delete permanently
              </Button>
              <Button variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          ))}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </section>
  );
}
