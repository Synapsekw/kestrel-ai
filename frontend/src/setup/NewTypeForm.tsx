import { useState, type FormEvent } from "react";
import type { TypeKind } from "@/api/catalogue";
import { KIND_OPTIONS, TYPE_HOTKEYS } from "@/catalogue/catalogueModel";
import { ColourSwatch } from "@/catalogue/ColourSwatch";
import { normaliseName } from "@/catalogue/normaliseName";
import { Button, Field, Input, Segmented, Select, useSeverityScale } from "@/ui";
import type { CatalogueTypeSpec } from "./api";
import { MAX_TYPES, freeColour, freeHotkey, type DraftType } from "./model";

/** "New type" (spec §8): name, kind, colour, severity, hotkey. The type lands in the Catalogue on Create. */
export function NewTypeForm({
  types,
  onAdd,
  onDone,
}: {
  types: readonly DraftType[];
  onAdd: (spec: CatalogueTypeSpec) => boolean;
  onDone: () => void;
}) {
  const scale = useSeverityScale();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<TypeKind>("defect");
  const [colour, setColour] = useState(() => freeColour(types));
  const [severity, setSeverity] = useState<number | null>(null);
  const [hotkey, setHotkey] = useState<string | null>(() => freeHotkey(types));
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError("Give the type a name.");
    if (types.some((t) => normaliseName(t.name) === normaliseName(clean)))
      return setError(`${clean} is already in the list.`);
    if (types.length >= MAX_TYPES) return setError(`A setup holds at most ${MAX_TYPES} types.`);
    const added = onAdd({
      name: clean,
      kind,
      colour,
      default_severity: severity,
      hotkey,
      definition: null,
      severity_rules: [],
    });
    if (!added) return setError("The type could not be added. Check the name.");
    onDone();
  }

  return (
    <form
      aria-label="New type"
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-control border border-line bg-surface-2 p-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type name" htmlFor="new-type-name" error={error}>
          <Input
            id="new-type-name"
            value={name}
            maxLength={64}
            invalid={error !== null}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Kind</span>
          <Segmented label="Kind" size="sm" value={kind} onChange={setKind} options={KIND_OPTIONS} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <span className="flex items-center gap-2 pb-1">
          <ColourSwatch label="Colour" value={colour} onChange={setColour} />
          <span className="text-xs text-muted">Colour</span>
        </span>
        <Field label="Default severity" htmlFor="new-type-severity">
          <Select
            id="new-type-severity"
            dense
            value={severity ?? ""}
            onChange={(e) => setSeverity(e.target.value ? Number(e.target.value) : null)}
            wrapperClassName="w-36"
          >
            <option value="">No default</option>
            {scale.map((l) => (
              <option key={l.level} value={l.level}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Hotkey" htmlFor="new-type-hotkey">
          <Select
            id="new-type-hotkey"
            dense
            value={hotkey ?? ""}
            onChange={(e) => setHotkey(e.target.value || null)}
            wrapperClassName="w-24"
          >
            <option value="">None</option>
            {TYPE_HOTKEYS.map((k) => (
              <option key={k} value={k}>
                {k.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" icon="plus">
          Add type
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
