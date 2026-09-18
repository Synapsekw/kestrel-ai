import { useEffect, useState } from "react";
import type { Model, Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchModels, patchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";

interface Props {
  project: Project;
  onSaved: (p: Project) => void;
}

export function PreannotationSection({ project, onSaved }: Props) {
  const api = useApi();
  const [models, setModels] = useState<Model[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchModels(api, project.id)
      .then((items) => {
        if (!cancelled) setModels(items);
      })
      .catch((e: unknown) => {
        pushLog(`models unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) {
          setModels([]);
          setUnavailable(
            "The model registry is not available yet (it arrives with the training backend). The current setting is kept.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, project.id]);

  async function choose(value: string) {
    setError(null);
    setStatus(null);
    try {
      onSaved(await patchProject(api, project.id, { preannotation_model_id: value || null }));
      setStatus("Pre-annotation model saved");
    } catch (e) {
      pushLog(`set preannotation model failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not save the pre-annotation model"));
    }
  }

  const current = project.preannotation_model_id ?? "";
  const known = models?.some((m) => m.id === current) ?? false;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Pre-annotation</h2>
      <p className="text-sm text-slate-400">
        This model runs on an image when the editor opens it and its proposals appear dashed until reviewed.
      </p>
      <label className="flex items-center gap-2 text-sm">
        Model
        <select
          aria-label="Pre-annotation model"
          value={current}
          disabled={unavailable !== null || models === null}
          onChange={(e) => void choose(e.target.value)}
          className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
        >
          <option value="">None</option>
          {!known && current && <option value={current}>{current}</option>}
          {(models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({m.kind})
            </option>
          ))}
        </select>
      </label>
      {unavailable && (
        <p role="note" className="text-xs text-slate-400">
          {unavailable}
        </p>
      )}
      {status && (
        <p role="status" className="text-xs text-emerald-300">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
