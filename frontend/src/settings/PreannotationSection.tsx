import { useEffect, useState } from "react";
import type { LibraryModel, Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchLibraryModels, isLibraryUnavailable } from "@/api/library";
import { patchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { originLabel } from "@/library/modelLabels";
import { Alert, Field, Select } from "@/ui";

interface Props {
  project: Project;
  onSaved: (p: Project) => void;
}

export function PreannotationSection({ project, onSaved }: Props) {
  const api = useApi();
  const [models, setModels] = useState<LibraryModel[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLibraryModels(api)
      .then((items) => {
        if (!cancelled) setModels(items);
      })
      .catch((e: unknown) => {
        pushLog(`library models unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) {
          setModels([]);
          setUnavailable(
            isLibraryUnavailable(e)
              ? "The model library could not be opened. The current setting is kept."
              : `The library models could not be loaded: ${messageOf(e, "unknown error")}. The current setting is kept.`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function choose(value: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      onSaved(await patchProject(api, project.id, { preannotation_model_id: value || null }));
      setStatus("Pre-annotation model saved");
    } catch (e) {
      pushLog(`set preannotation model failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not save the pre-annotation model"));
    } finally {
      setBusy(false);
    }
  }

  const current = project.preannotation_model_id ?? "";
  const known = models?.some((m) => m.id === current) ?? false;
  return (
    <section className="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Pre-annotation</h2>
        <p className="text-sm text-muted">
          This model runs on an image when the editor opens it; its suggestions appear dashed until reviewed.
        </p>
      </div>
      <Field label="Model" htmlFor="preannotation-model" className="max-w-sm">
        <Select
          id="preannotation-model"
          aria-label="Pre-annotation model"
          value={current}
          disabled={unavailable !== null || models === null || busy}
          onChange={(e) => void choose(e.target.value)}
        >
          <option value="">None</option>
          {!known && current && <option value={current}>Not in the library ({current.slice(0, 8)})</option>}
          <optgroup label="Models in your library">
            {(models ?? []).map((m) => (
              <option key={m.id} value={m.id} disabled={m.state === "unavailable"}>
                {m.name} ({originLabel(m.origin)}){m.state === "unavailable" ? " (file missing)" : ""}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>
      {unavailable && (
        <p role="note" className="text-xs text-muted">
          {unavailable}
        </p>
      )}
      {status && (
        <p role="status" className="text-xs text-ok">
          {status}
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  );
}
