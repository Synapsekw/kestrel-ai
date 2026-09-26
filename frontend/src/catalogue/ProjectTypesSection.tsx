import { useMemo, useState } from "react";
import type { Project } from "@contract/client";
import { createCatalogueType, existingTypeId, isHotkeyConflict, type TypeKind } from "@/api/catalogue";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { saveProjectTypes } from "@/api/projectTypes";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, IconButton, Input, Segmented, Select, TypeChip } from "@/ui";
import { KIND_OPTIONS, TYPE_HOTKEYS, nextTypeColour } from "./catalogueModel";
import {
  addRow,
  exactMatch,
  hotkeyProblem,
  moveRow,
  removeRow,
  rowsOf,
  suggestions,
  toTypesBody,
  typeInUseMessage,
  type TypeRow,
} from "./projectTypesModel";
import { useCatalogue } from "./useCatalogue";

/** Project settings → Types (F §7.3): the catalogue types this project uses, in order. */
export function ProjectTypesSection({
  project,
  onSaved,
}: {
  project: Project;
  onSaved: (p: Project) => void;
}) {
  const api = useApi();
  const catalogue = useCatalogue();
  const initial = useMemo(() => rowsOf(project.classes, catalogue.types), [project.classes, catalogue.types]);
  const [edited, setEdited] = useState<TypeRow[] | null>(null);
  const rows = edited ?? initial;
  const [query, setQuery] = useState("");
  const [newKind, setNewKind] = useState<TypeKind>("defect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const edit = (next: TypeRow[]) => {
    setEdited(next);
    setStatus(null);
  };
  const matches = suggestions(query, catalogue.types, rows);
  const exact = exactMatch(query, catalogue.types);

  async function createType() {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createCatalogueType(api, {
        name,
        colour: nextTypeColour(catalogue.types),
        kind: newKind,
        default_severity: null,
        hotkey: null,
        group: null,
      });
      catalogue.put(created);
      edit(addRow(rows, created));
      setQuery("");
    } catch (e) {
      pushLog(`create type from project settings failed: ${messageOf(e, String(e))}`);
      const existing = catalogue.types.find((t) => t.id === existingTypeId(e));
      if (existing) {
        edit(addRow(rows, existing));
        setQuery("");
      } else setError(messageOf(e, "could not create the type"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const problem = hotkeyProblem(rows);
    setError(problem);
    setStatus(null);
    if (problem) return;
    setBusy(true);
    try {
      const saved = await saveProjectTypes(api, project.id, toTypesBody(rows));
      setEdited(null);
      setStatus("Types saved");
      onSaved(saved);
    } catch (e) {
      pushLog(`save project types failed: ${messageOf(e, String(e))}`);
      // A removed type is gone from `rows` by now; `initial` still has its name for the message.
      setError(
        typeInUseMessage(e, [...rows, ...initial]) ??
          (isHotkeyConflict(e)
            ? "Two types share a hotkey in this project."
            : messageOf(e, "could not save the types")),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 py-8 first:pt-0 last:pb-0" aria-labelledby="project-types-title">
      <div className="flex flex-col gap-1">
        <h2 id="project-types-title" className="text-lg font-semibold">
          Types
        </h2>
        <p className="text-sm text-muted">
          The catalogue types this project uses, in order. Names and colours come from the Catalogue.
        </p>
      </div>
      <ol className="flex flex-col divide-y divide-line rounded-panel border border-line">
        {rows.map((r, i) => (
          <li key={r.typeId} className="flex items-center gap-3 px-3 py-2">
            <span className="w-5 text-right font-mono text-xs tabular-nums text-dim">{i + 1}</span>
            <TypeChip name={r.name} colour={r.colour} kind={r.kind} />
            {r.group && <span className="truncate text-xs text-muted">{r.group}</span>}
            <span className="ml-auto flex items-center gap-1">
              <Select
                aria-label={`Hotkey of ${r.name}`}
                value={r.override}
                onChange={(e) =>
                  edit(rows.map((x) => (x.typeId === r.typeId ? { ...x, override: e.target.value } : x)))
                }
                className="w-32"
              >
                <option value="">
                  {r.catalogueHotkey ? `Default (${r.catalogueHotkey.toUpperCase()})` : "None"}
                </option>
                {TYPE_HOTKEYS.map((k) => (
                  <option key={k} value={k}>
                    {k.toUpperCase()}
                  </option>
                ))}
              </Select>
              <IconButton
                icon="chevron-down"
                label={`Move ${r.name} up`}
                size="sm"
                className="[&_svg]:rotate-180"
                disabled={i === 0}
                onClick={() => edit(moveRow(rows, i, -1))}
              />
              <IconButton
                icon="chevron-down"
                label={`Move ${r.name} down`}
                size="sm"
                disabled={i === rows.length - 1}
                onClick={() => edit(moveRow(rows, i, 1))}
              />
              <IconButton
                icon="trash"
                label={`Remove ${r.name}`}
                size="sm"
                onClick={() => edit(removeRow(rows, r.typeId))}
              />
            </span>
          </li>
        ))}
      </ol>

      {catalogue.unavailable ? (
        <Alert tone="info">The catalogue is not available, so types cannot be added now.</Alert>
      ) : (
        <div className="flex flex-col gap-2">
          <Input
            aria-label="Add type"
            placeholder="Add type: search the catalogue or name a new one"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-md"
          />
          <div className="flex flex-wrap items-center gap-2">
            {matches.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant="secondary"
                onClick={() => {
                  edit(addRow(rows, t));
                  setQuery("");
                }}
              >
                Add {t.name}
              </Button>
            ))}
            {query.trim() && !exact && (
              <>
                <Segmented
                  label="Kind of the new type"
                  size="sm"
                  options={KIND_OPTIONS}
                  value={newKind}
                  onChange={setNewKind}
                />
                <Button size="sm" icon="plus" loading={busy} onClick={() => void createType()}>
                  Create "{query.trim()}"
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
      {status && (
        <Alert tone="ok" role="status">
          {status}
        </Alert>
      )}
      <Button
        variant="primary"
        className="self-start"
        loading={busy}
        disabled={edited === null}
        onClick={() => void save()}
      >
        Save types
      </Button>
    </section>
  );
}
