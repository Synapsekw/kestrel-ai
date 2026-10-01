import { useId, useState } from "react";
import type { TypeKind } from "@/api/catalogue";
import { KIND_OPTIONS, TYPE_HOTKEYS } from "@/catalogue/catalogueModel";
import { ColourSwatch } from "@/catalogue/ColourSwatch";
import { SeverityRulesEditor } from "@/catalogue/SeverityRulesEditor";
import { rulesOf, toRules, validateRules, type RuleDraft } from "@/catalogue/severityRulesModel";
import { Field, IconButton, Select, Textarea, cx, useSeverityScale } from "@/ui";
import type { CatalogueTypeSpec, TypeConflict } from "./api";
import { NO_COLOUR, conflictText, type DraftType } from "./model";

export interface TypeRowProps {
  type: DraftType;
  conflict: TypeConflict | null;
  /** The name of another type on the same hotkey, or null. */
  clashWith: string | null;
  onChange: (patch: Partial<CatalogueTypeSpec>) => void;
  onRemove: () => void;
}

/** One anomaly type (spec §8 Anomalies): colour, name, kind, severity, hotkey, notes, and its details. */
export function TypeRow({ type, conflict, clashWith, onChange, onRemove }: TypeRowProps) {
  const scale = useSeverityScale();
  const [open, setOpen] = useState(false);
  // The editor works on keyed drafts; the draft store only ever receives plain rules. A template switch
  // gives the row a new React key, so the drafts start afresh from the new type.
  const [rules, setRules] = useState<RuleDraft[]>(() => rulesOf(type.severity_rules));
  const rulesProblem = validateRules(rules, scale);
  const detailsId = useId();
  const note = conflict ? conflictText(type, conflict) : null;
  return (
    <li
      aria-label={type.name}
      className="flex flex-col gap-2 rounded-control border border-line bg-surface px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ColourSwatch
          label={`Colour of ${type.name}`}
          value={type.colour ?? NO_COLOUR}
          onChange={(colour) => onChange({ colour })}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{type.name}</span>
        <Select
          dense
          aria-label={`Kind of ${type.name}`}
          value={type.kind}
          onChange={(e) => onChange({ kind: e.target.value as TypeKind })}
          wrapperClassName="w-24"
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          dense
          aria-label={`Severity of ${type.name}`}
          value={type.default_severity ?? ""}
          onChange={(e) => onChange({ default_severity: e.target.value ? Number(e.target.value) : null })}
          wrapperClassName="w-32"
        >
          <option value="">No default</option>
          {scale.map((l) => (
            <option key={l.level} value={l.level}>
              {l.name}
            </option>
          ))}
        </Select>
        <Select
          dense
          aria-label={`Hotkey of ${type.name}`}
          invalid={clashWith !== null}
          value={type.hotkey ?? ""}
          onChange={(e) => onChange({ hotkey: e.target.value || null })}
          wrapperClassName="w-20"
        >
          <option value="">None</option>
          {TYPE_HOTKEYS.map((k) => (
            <option key={k} value={k}>
              {k.toUpperCase()}
            </option>
          ))}
        </Select>
        <IconButton
          icon="chevron-down"
          size="sm"
          label={`Details of ${type.name}`}
          aria-expanded={open}
          aria-controls={detailsId}
          className={cx(open && "rotate-180")}
          onClick={() => setOpen((o) => !o)}
        />
        <IconButton icon="trash" size="sm" label={`Remove ${type.name}`} onClick={onRemove} />
      </div>
      {(note || clashWith) && (
        <p className="flex flex-col gap-0.5 text-2xs">
          {note && <span className="text-warn">{note}</span>}
          {clashWith && (
            <span className="text-danger">{`Hotkey ${(type.hotkey ?? "").toUpperCase()} is also used by ${clashWith}.`}</span>
          )}
        </p>
      )}
      {open && (
        <div id={detailsId} className="flex flex-col gap-3 border-t border-line pt-3">
          <Field
            label="Definition"
            htmlFor={`${detailsId}-definition`}
            hint="What this anomaly looks like, in one or two sentences."
          >
            <Textarea
              id={`${detailsId}-definition`}
              rows={2}
              maxLength={1000}
              value={type.definition ?? ""}
              onChange={(e) => onChange({ definition: e.target.value || null })}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-muted">Severity rules</p>
            <SeverityRulesEditor
              rules={rules}
              defaultSeverity={type.default_severity ?? null}
              onChange={(next) => {
                setRules(next);
                onChange({ severity_rules: toRules(next) });
              }}
            />
            {rulesProblem && <p className="text-xs text-danger">{rulesProblem}</p>}
          </div>
        </div>
      )}
    </li>
  );
}
