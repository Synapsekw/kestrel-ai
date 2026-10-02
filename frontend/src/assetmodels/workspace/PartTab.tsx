import { useState } from "react";
import { Link } from "react-router-dom";
import type { AssetPart, AssetSpec } from "@contract/client";
import { editNote, numericParams, withNote, withParam, withPlacement } from "@/assetmodels/partEdit";
import { ApiFailure, messageOf } from "@/api/errors";
import { Alert, Button, EmptyState, Field, Input, Pill, Textarea, toast } from "@/ui";

type PlacementKey = "bearing_deg" | "elevation_mm" | "e_mm" | "n_mm";
const PLACEMENT_KEYS: readonly PlacementKey[] = ["bearing_deg", "elevation_mm", "e_mm", "n_mm"];

const NAMES: Record<string, string> = {
  id: "Inside diameter",
  od: "Outside diameter",
  dn: "DN",
  d: "Diameter",
  w: "Width",
  l: "Length",
  h: "Height",
  r: "Radius",
  d_bottom: "Bottom diameter",
  d_top: "Top diameter",
  crown_r: "Crown radius",
  knuckle_r: "Knuckle radius",
  flange_od: "Flange OD",
  flange_t: "Flange thickness",
  sweep_deg: "Sweep",
  bearing_deg: "Bearing",
  elevation_mm: "Elevation",
  e_mm: "East",
  n_mm: "North",
};
const UNITLESS = new Set(["dn", "ratio", "slope"]);

const label = (key: string) => {
  const plain = key.replace(/_deg$|_mm$/, "").replace(/_/g, " ");
  return NAMES[key] ?? plain.charAt(0).toUpperCase() + plain.slice(1);
};
const unit = (key: string) => (key.endsWith("_deg") ? "°" : UNITLESS.has(key) ? "" : "mm");
const CONFIDENCE = { high: "ok", medium: "neutral", low: "warn" } as const;

export interface Deviation {
  median_mm: number;
  p95_mm: number;
}

function NumberField({
  name,
  value,
  onChange,
}: {
  name: string;
  value: string;
  onChange(value: string): void;
}) {
  const id = `part-field-${name}`;
  const invalid = value.trim() === "" || !Number.isFinite(Number(value));
  return (
    <Field
      htmlFor={id}
      label={
        <>
          {label(name)}
          {unit(name) && <span className="ml-1 text-dim">{unit(name)}</span>}
        </>
      }
    >
      <Input
        id={id}
        type="number"
        step="any"
        dense
        invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function Source({ projectId, part }: { projectId: string; part: AssetPart }) {
  const s = part.source;
  const what =
    s.kind === "drawing" ? (
      s.id ? (
        <Link
          className="text-accent-ink underline-offset-2 hover:underline"
          to={`/p/${projectId}/maps?sel=drawing:${s.id}`}
        >
          {s.region ? "Drawing · region" : "Drawing"}
        </Link>
      ) : (
        "Drawing"
      )
    ) : s.kind === "cloud" ? (
      "Point cloud"
    ) : s.kind === "photo" ? (
      "Photo"
    ) : (
      <Pill size="sm" tone="warn">
        Assumed
      </Pill>
    );
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
      <span>Source</span>
      <span className="text-ink">{what}</span>
      {s.note && <span>· {s.note}</span>}
    </p>
  );
}

function OtherParams({ part }: { part: AssetPart }) {
  const rows = Object.entries(part.params).filter(
    ([, v]) => typeof v !== "number" && v !== null && v !== undefined,
  );
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{label(k)}</dt>
          <dd className="font-mono text-ink">
            {typeof v === "boolean"
              ? v
                ? "yes"
                : "no"
              : Array.isArray(v)
                ? `${v.length} points`
                : String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One part: its numbers as editable fields, its placement, where it came from and how far the scan
 * says it is off. Save writes a new manual version; the server's spec errors are shown inline.
 */
export function PartTab({
  projectId,
  spec,
  partId,
  fallbackName,
  deviation,
  onSave,
}: {
  projectId: string;
  spec: AssetSpec | null;
  partId: string | null;
  /** The viewer's name for a part the spec does not list. */
  fallbackName?: string;
  deviation: Deviation | null;
  onSave(spec: AssetSpec, note: string): Promise<void>;
}) {
  const part = spec?.parts?.find((p) => p.id === partId) ?? null;
  const hosted = !!part?.placement?.host;
  const params = part ? numericParams(part) : [];
  const placement =
    part && hosted
      ? PLACEMENT_KEYS.filter((k) => typeof part.placement?.[k] === "number").map((key) => ({
          key,
          value: part.placement![key] as number,
        }))
      : [];
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  if (!partId)
    return (
      <EmptyState icon="cursor" title="Pick a part">
        Click a part in the view or in the Parts list.
      </EmptyState>
    );
  if (!spec) return <p className="p-2 text-sm text-muted">Loading the part…</p>;
  if (!part)
    return (
      <div className="flex flex-col gap-1 p-2">
        <h3 className="text-lg font-semibold text-ink">{fallbackName ?? partId}</h3>
        <p className="text-sm text-muted">This part is not in the version&apos;s spec.</p>
      </div>
    );

  const valueOf = (key: string, before: number) => draft[key] ?? String(before);
  const changed = [...params, ...placement].filter(
    ({ key, value }) => draft[key] !== undefined && Number(draft[key]) !== value,
  );
  const noteChanged = note !== null && note !== (part.note ?? "");
  const invalid = Object.values(draft).some((v) => v.trim() === "" || !Number.isFinite(Number(v)));
  const dirty = (changed.length > 0 || noteChanged) && !invalid;

  const save = async () => {
    let next = spec;
    const lines: string[] = [];
    for (const { key, value } of changed) {
      const after = Number(draft[key]);
      next = (PLACEMENT_KEYS as readonly string[]).includes(key)
        ? withPlacement(next, part.id, key as PlacementKey, after)
        : withParam(next, part.id, key, after);
      lines.push(editNote(part, key, value, after));
    }
    if (noteChanged) {
      next = withNote(next, part.id, note ?? "");
      lines.push(`${part.id}: note`);
    }
    setSaving(true);
    setErrors([]);
    try {
      await onSave(next, lines.join("; "));
    } catch (e) {
      const list = e instanceof ApiFailure && e.status === 422 ? e.details.errors : null;
      if (Array.isArray(list) && list.length > 0) {
        setErrors(list.map((x: { message?: unknown }) => String(x.message ?? "")).filter(Boolean));
      } else if (e instanceof ApiFailure && e.status === 422) {
        setErrors([e.message]);
      } else {
        toast("danger", messageOf(e, "The version could not be saved."));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3.5 p-1">
      <header className="flex flex-col gap-1">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-lg font-semibold text-ink">{part.name}</h3>
          {part.confidence && (
            <Pill size="sm" tone={CONFIDENCE[part.confidence]}>
              {part.confidence} confidence
            </Pill>
          )}
        </div>
        <p className="text-xs text-muted">
          {part.group} · {part.shape.replace(/_/g, " ")} · <span className="font-mono">{part.id}</span>
        </p>
        <Source projectId={projectId} part={part} />
        {deviation && (
          <p className="text-xs text-muted">
            Scan deviation{" "}
            <span className="font-mono tabular-nums text-ink">
              {`median ${deviation.median_mm} mm · p95 ${deviation.p95_mm} mm`}
            </span>
          </p>
        )}
      </header>
      {params.length > 0 && (
        <section aria-label="Dimensions" className="grid grid-cols-2 items-end gap-2.5">
          {params.map(({ key, value }) => (
            <NumberField
              key={key}
              name={key}
              value={valueOf(key, value)}
              onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
            />
          ))}
        </section>
      )}
      <OtherParams part={part} />
      <section aria-label="Placement" className="flex flex-col gap-2 border-t border-line pt-3">
        <h4 className="text-xs font-medium text-muted">
          Placement
          {hosted && (
            <span className="font-normal">
              {" "}
              on <span className="font-mono text-ink">{part.placement!.host}</span>
            </span>
          )}
        </h4>
        {placement.length > 0 ? (
          <div className="grid grid-cols-2 gap-2.5">
            {placement.map(({ key, value }) => (
              <NumberField
                key={key}
                name={key}
                value={valueOf(key, value)}
                onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
              />
            ))}
          </div>
        ) : (
          <p className="font-mono text-xs tabular-nums text-ink">
            {part.placement?.origin_mm
              ? `origin ${part.placement.origin_mm.join(", ")} mm`
              : "at the asset origin"}
          </p>
        )}
      </section>
      <Field label="Note" htmlFor="part-field-note">
        <Textarea
          id="part-field-note"
          rows={2}
          value={note ?? part.note ?? ""}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {errors.length > 0 && (
        <Alert tone="danger" title="The spec has errors">
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {errors.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}
      <Button variant="primary" icon="check" disabled={!dirty} loading={saving} onClick={() => void save()}>
        Save as new version
      </Button>
    </div>
  );
}
