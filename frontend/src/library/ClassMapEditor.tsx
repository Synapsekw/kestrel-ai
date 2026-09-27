import { useMemo, useState } from "react";
import type { LibraryModel } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { saveClassMap } from "@/api/library";
import { pushLog } from "@/app/diagnostics";
import { useCatalogue } from "@/catalogue/useCatalogue";
import { Alert, Button, Select, SkeletonRows, TypeChip } from "@/ui";
import { IGNORE, draftsOf, resolveClass, toClassMap, unmappedCount } from "./classMapModel";

/** Library → model detail → Class mapping (F §7.4): asked once per model, not once per project. */
export function ClassMapEditor({
  model,
  onSaved,
}: {
  model: LibraryModel;
  onSaved: (m: LibraryModel) => void;
}) {
  const api = useApi();
  const catalogue = useCatalogue();
  const live = useMemo(() => catalogue.types.filter((t) => !t.archived), [catalogue.types]);
  const base = useMemo(() => draftsOf(model, catalogue.types), [model, catalogue.types]);
  const [edits, setEdits] = useState<Record<string, string> | null>(null);
  const current = edits ?? base;
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(toClassMap(current)) !== JSON.stringify(toClassMap(base));
  const unmapped = unmappedCount(current);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await saveClassMap(api, model.id, toClassMap(current));
      setEdits(null);
      setSaved(true);
      onSaved(next);
    } catch (e) {
      pushLog(`save class map ${model.id} failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not save the class mapping"));
    } finally {
      setBusy(false);
    }
  }

  if (catalogue.loading) return <SkeletonRows rows={3} columns={2} />;
  if (catalogue.unavailable) {
    return (
      <Alert tone="info">
        The catalogue is not available, so the class mapping cannot be edited now. Runs keep using the saved
        mapping.
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        Detections of each model class become this catalogue type. Classes whose name or alias matches a type
        are mapped automatically.
      </p>
      <table data-testid="class-map" className="w-full text-sm">
        <tbody>
          {model.class_names.map((name) => {
            const r = resolveClass(name, model, catalogue.types);
            return (
              <tr key={name} className="border-b border-line last:border-b-0">
                <td className="py-1.5 pr-3 font-mono text-xs">{name}</td>
                <td className="py-1.5">
                  {r.kind === "name" || r.kind === "alias" ? (
                    <span className="flex items-center gap-2">
                      <TypeChip name={r.type.name} colour={r.type.colour} kind={r.type.kind} />
                      <span className="text-xs text-muted">
                        {r.kind === "name" ? "by name" : `by alias ${r.alias}`}
                      </span>
                    </span>
                  ) : (
                    <Select
                      aria-label={`Type for ${name}`}
                      value={current[name] ?? ""}
                      onChange={(e) => {
                        setSaved(false);
                        setEdits({ ...current, [name]: e.target.value });
                      }}
                    >
                      {/* The server merges the map, so a stored class cannot go back to "not mapped". */}
                      <option value="" disabled={base[name] !== ""}>
                        Not mapped
                      </option>
                      <option value={IGNORE}>Ignore</option>
                      {live.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {unmapped > 0 && (
        <p className="text-xs text-warn">
          {unmapped === 1 ? "1 class is" : `${unmapped} classes are`} not mapped. A run with this model asks
          for them before it starts.
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {saved && !dirty && (
        <Alert tone="ok" role="status">
          Class mapping saved
        </Alert>
      )}
      <Button
        size="sm"
        variant="primary"
        className="self-start"
        disabled={!dirty}
        loading={busy}
        onClick={() => void save()}
      >
        Save class mapping
      </Button>
    </div>
  );
}
