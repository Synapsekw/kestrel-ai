import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createVersion, getVersion } from "@/api/assetModels";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import type { AssetItem, CatalogueEntry } from "@/api/plantItems";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Disclosure, Field, Input, Select, Switch, Textarea, toast } from "@/ui";
import { HEIGHT_SOURCE } from "./itemFormat";
import {
  applyDraft,
  draftOf,
  editNote,
  effectiveHeightSource,
  fieldsFromSchema,
  sameDraft,
  validateDraft,
  withItem,
  type FieldSpec,
  type ItemDraft,
} from "./itemEdit";

export interface ItemEditorProps {
  projectId: string;
  modelId: string;
  /** The version the edit starts from (spec §11: the editor shows the base version). */
  baseVersion: number;
  item: AssetItem;
  catalogue: readonly CatalogueEntry[];
  onSaved(version: number, jobId: string): void;
  onCancel(): void;
  onDirty(dirty: boolean): void;
}

const HEIGHT_SOURCES = Object.entries(HEIGHT_SOURCE) as [ItemDraft["height_source"], { label: string }][];
const FP_LABELS: Record<string, string> = {
  e: "Centre E",
  n: "Centre N",
  along: "Length along",
  across: "Width across",
  rot: "Rotation",
  d: "Diameter",
  width: "Width",
};
const FP_UNITS: Record<string, string> = { rot: "°" };
const SET_BY_HAND = "Set by hand. The scan check will keep it.";

function withUnit(label: string, unit?: string) {
  return (
    <>
      {label}
      {unit && <span className="text-dim">{` ${unit}`}</span>}
    </>
  );
}

function NumberInput({
  id,
  label,
  unit,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  unit?: string;
  value: string;
  error?: string;
  onChange(v: string): void;
}) {
  return (
    <Field htmlFor={id} label={withUnit(label, unit)} error={error}>
      <Input
        id={id}
        type="number"
        step="any"
        dense
        invalid={!!error}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono tabular-nums"
      />
    </Field>
  );
}

function ParamInput({
  f,
  value,
  error,
  onChange,
  idBase,
}: {
  f: FieldSpec;
  value: string | boolean;
  error?: string;
  onChange(v: string | boolean): void;
  idBase: string;
}) {
  const id = `${idBase}-${f.key}`;
  if (f.kind === "boolean") return <Switch checked={value === true} onChange={onChange} label={f.label} />;
  if (f.kind === "enum")
    return (
      <Field htmlFor={id} label={f.label} hint={f.help}>
        <Select id={id} dense value={String(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">
            {f.defaultValue != null ? `Default (${String(f.defaultValue)})` : "Default"}
          </option>
          {(f.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      </Field>
    );
  if (f.kind === "json")
    return (
      <Field htmlFor={id} label={f.label} hint={f.help ?? "JSON"} error={error}>
        <Textarea
          id={id}
          rows={2}
          invalid={!!error}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
        />
      </Field>
    );
  if (f.kind === "string")
    return (
      <Field htmlFor={id} label={f.label} hint={f.help}>
        <Input id={id} dense value={String(value)} onChange={(e) => onChange(e.target.value)} />
      </Field>
    );
  return (
    <Field
      htmlFor={id}
      label={withUnit(f.label, f.unit)}
      error={error}
      hint={f.help ?? (f.defaultValue != null ? `Default ${String(f.defaultValue)}` : undefined)}
    >
      <Input
        id={id}
        type="number"
        step={f.kind === "integer" ? 1 : "any"}
        dense
        invalid={!!error}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono tabular-nums"
      />
    </Field>
  );
}

/** Spec §11 Edit: type, footprint numbers, heights and params; saves a manual version from the base. */
export function ItemEditor(p: ItemEditorProps) {
  const api = useApi();
  const ids = useId();
  const fieldsFor = (type: string) =>
    fieldsFromSchema(p.catalogue.find((c) => c.type === type)?.params_schema);
  const itemFields = useMemo(
    () => fieldsFromSchema(p.catalogue.find((c) => c.type === p.item.type)?.params_schema),
    [p.item.type, p.catalogue],
  );
  const initial = useMemo(() => draftOf(p.item, itemFields), [p.item, itemFields]);
  const [draft, setDraft] = useState<ItemDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typeChanged = draft.type !== p.item.type;
  const otherFields = useMemo(
    () =>
      typeChanged ? fieldsFromSchema(p.catalogue.find((c) => c.type === draft.type)?.params_schema) : null,
    [typeChanged, draft.type, p.catalogue],
  );
  const fields = otherFields ?? itemFields;
  const kind = (p.item.footprint as unknown as { kind: string }).kind;
  const errors = validateDraft(draft, fields, kind);
  const dirty = !sameDraft(draft, initial);
  const heightSource = effectiveHeightSource(p.item, draft);
  const setByHand = heightSource !== draft.height_source;
  const onDirty = useRef(p.onDirty);
  useEffect(() => {
    onDirty.current = p.onDirty;
  });
  useEffect(() => {
    onDirty.current(dirty);
  }, [dirty]);

  const set = (patch: Partial<ItemDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setType = (type: string) => {
    const params =
      type === p.item.type
        ? initial.params
        : draftOf({ ...p.item, type, params: {} } as AssetItem, fieldsFor(type)).params;
    setDraft((d) => ({ ...d, type, params }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      // The base version's spec, read once per save (budget): the edit replaces one item in it.
      const base = await getVersion(api, p.projectId, p.modelId, p.baseVersion);
      const next = applyDraft(p.item, draft, fields);
      const { version, job } = await createVersion(
        api,
        p.projectId,
        p.modelId,
        withItem(base.spec, next),
        editNote(p.item, next, p.baseVersion),
      );
      useJobsStore.getState().upsert(job);
      toast("ok", `Saved version ${version.version}`);
      p.onSaved(version.version, job.id);
    } catch (e) {
      setError(messageOf(e, "The edit could not be saved."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      aria-label={`Edit ${p.item.name}`}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <header className="flex flex-col gap-0.5">
        <h2 className="text-lg font-semibold text-ink">{`Edit ${p.item.tag ?? p.item.name}`}</h2>
        <p className="text-xs text-muted">
          Editing from version <span className="font-mono tabular-nums text-ink">{p.baseVersion}</span>.
          Saving adds a new version; this one stays.
        </p>
      </header>
      <Field
        htmlFor={`${ids}-type`}
        label="Type"
        hint={
          typeChanged ? "The params start from the new type's defaults; the old ones are dropped." : undefined
        }
      >
        <Select id={`${ids}-type`} dense value={draft.type} onChange={(e) => setType(e.target.value)}>
          {p.catalogue.map((c) => (
            <option key={c.type} value={c.type}>
              {c.type.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <NumberInput
          id={`${ids}-base`}
          label="Base EL"
          unit="m"
          value={draft.base_el}
          error={errors.base_el}
          onChange={(v) => set({ base_el: v })}
        />
        <NumberInput
          id={`${ids}-top`}
          label="Top EL"
          unit="m"
          value={draft.top_el}
          error={errors.top_el}
          onChange={(v) => set({ top_el: v })}
        />
      </div>
      <Field htmlFor={`${ids}-hs`} label="Height source" hint={setByHand ? SET_BY_HAND : undefined}>
        <Select
          id={`${ids}-hs`}
          dense
          value={heightSource}
          disabled={setByHand}
          onChange={(e) => set({ height_source: e.target.value as ItemDraft["height_source"] })}
        >
          {HEIGHT_SOURCES.map(([value, h]) => (
            <option key={value} value={value}>
              {h.label}
            </option>
          ))}
        </Select>
      </Field>
      <section aria-label="Footprint" className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted">Footprint</h3>
        {Object.keys(draft.fp).length === 0 && (
          <p className="text-xs text-muted">
            {`${((p.item.footprint as unknown as { pts?: unknown[] }).pts ?? []).length} points. The outline is edited in a later release.`}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(draft.fp).map(([k, v]) => (
            <NumberInput
              key={k}
              id={`${ids}-fp-${k}`}
              label={FP_LABELS[k] ?? k}
              unit={FP_UNITS[k] ?? "m"}
              value={v}
              error={errors[`fp.${k}`]}
              onChange={(nv) => setDraft((d) => ({ ...d, fp: { ...d.fp, [k]: nv } }))}
            />
          ))}
        </div>
      </section>
      {fields.length > 0 && (
        <Disclosure label="Parameters" defaultOpen>
          <div className="flex flex-col gap-2">
            {fields.map((f) => (
              <ParamInput
                key={f.key}
                f={f}
                idBase={`${ids}-p`}
                value={draft.params[f.key] ?? ""}
                error={errors[`params.${f.key}`]}
                onChange={(v) => setDraft((d) => ({ ...d, params: { ...d.params, [f.key]: v } }))}
              />
            ))}
          </div>
        </Disclosure>
      )}
      {error && (
        <Alert tone="danger" title="The edit could not be saved.">
          {error}
        </Alert>
      )}
      <div className="mt-auto flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={p.onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!dirty || Object.keys(errors).length > 0 || saving}>
          {saving ? "Saving…" : "Save as new version"}
        </Button>
      </div>
    </form>
  );
}
