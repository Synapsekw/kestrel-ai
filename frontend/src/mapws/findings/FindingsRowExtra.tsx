import { useId } from "react";
import { Checkbox, Field, Select, Switch, useSeverityScale } from "@/ui";
import type { LayerRowExtraProps } from "@/mapws/annotations/bindings";
import { useMapFindingsStore } from "./store";
import { findingFilters, findingsMeta, visibleFindings } from "./tooltip";

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "reviewed", label: "Reviewed" },
  { value: "closed", label: "Closed" },
] as const;

/** The Findings row's live count and filters (W3-9, W3-13, W3-19). */
export function FindingsRowExtra({ style, setStyle }: LayerRowExtraProps) {
  const f = findingFilters(style);
  const byId = useMapFindingsStore((s) => s.byId);
  const truncated = useMapFindingsStore((s) => s.truncated);
  const scale = useSeverityScale();
  const severityId = useId();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xs text-muted">
        {findingsMeta(visibleFindings(Object.values(byId), f), truncated, scale)}
      </p>
      <Switch
        checked={f.allSurveys}
        onChange={(allSurveys) => setStyle({ allSurveys })}
        label="All surveys"
      />
      <fieldset className="flex flex-wrap gap-x-3 gap-y-1">
        <legend className="sr-only">Status</legend>
        {STATUSES.map((s) => (
          <Checkbox
            key={s.value}
            label={s.label}
            checked={f.statuses.includes(s.value)}
            onChange={() =>
              setStyle({
                statuses: f.statuses.includes(s.value)
                  ? f.statuses.filter((x) => x !== s.value)
                  : [...f.statuses, s.value],
              })
            }
          />
        ))}
      </fieldset>
      <Field label="Severity at least" htmlFor={severityId}>
        <Select
          id={severityId}
          dense
          value={f.minSeverity === null ? "" : String(f.minSeverity)}
          onChange={(e) => setStyle({ minSeverity: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">Any, including none</option>
          {scale.map((l) => (
            <option key={l.level} value={l.level}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
