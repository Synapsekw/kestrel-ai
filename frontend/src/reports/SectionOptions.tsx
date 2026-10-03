import { Checkbox, Field, Input, Segmented, Select, Switch, Textarea, useSeverityScale } from "@/ui";
import type { Sections } from "./builderModel";

type ReportSection = Sections[number];
type Opts = Record<string, unknown>;
const bool = (o: Opts, k: string, d: boolean): boolean => (typeof o[k] === "boolean" ? (o[k] as boolean) : d);
const str = (o: Opts, k: string, d: string): string => (typeof o[k] === "string" ? (o[k] as string) : d);
const num = (o: Opts, k: string, d: number): number => (typeof o[k] === "number" ? (o[k] as number) : d);
const list = (o: Opts, k: string, d: readonly string[]): string[] =>
  Array.isArray(o[k]) ? (o[k] as string[]) : [...d];
const toggle = (xs: string[], v: string): string[] =>
  xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v];

const TABLE_COLUMNS = [
  ["number", "Number"],
  ["type", "Type"],
  ["severity", "Severity"],
  ["status", "Status"],
  ["data_item", "Data item"],
  ["observed", "Observed"],
  ["note", "Note"],
  ["zone", "Zone"],
  ["side", "Side"],
  ["height", "Height"],
  ["sightings", "Sightings"],
] as const;
const TABLE_SORTS = [
  ["severity_desc", "Severity, worst first"],
  ["number", "Finding number"],
  ["type", "Type"],
  ["observed", "Observed date"],
] as const;
const SNAPSHOT_KINDS = [
  ["image", "Image"],
  ["map", "Map"],
  ["cloud", "3D view"],
] as const;
const MEASUREMENT_KINDS = [
  ["length", "Length"],
  ["area", "Area"],
  ["height", "Height"],
  ["lean", "Lean"],
  ["profile", "Profile"],
  ["volume", "Volume"],
] as const;
type Comments = "none" | "last" | "all";
type Mode = "swipe" | "side_by_side" | "both";

function CheckGroup({
  legend,
  items,
  value,
  onChange,
  keepOne = false,
}: {
  legend: string;
  items: readonly (readonly [string, string])[];
  value: string[];
  onChange: (v: string[]) => void;
  /** The contract needs at least one ticked (`minItems: 1`): the last ticked box cannot be cleared. */
  keepOne?: boolean;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs font-medium text-muted">{legend}</legend>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {items.map(([v, label]) => (
          <Checkbox
            key={v}
            label={label}
            checked={value.includes(v)}
            disabled={keepOne && value.length === 1 && value.includes(v)}
            onChange={() => onChange(toggle(value, v))}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** One section's options (spec §7.2), inside its Disclosure. Unknown option keys are kept as they are. */
export function SectionOptions({
  section,
  onChange,
}: {
  section: ReportSection;
  onChange: (patch: Opts) => void;
}) {
  const scale = useSeverityScale();
  const o = (section.options ?? {}) as Opts;
  const id = `section-${section.key}`;
  switch (section.key) {
    case "cover":
      return (
        <Switch
          checked={bool(o, "show_locator", true)}
          onChange={(v) => onChange({ show_locator: v })}
          label="Site locator map"
        />
      );
    case "summary":
      return (
        <div className="flex flex-col gap-3">
          <Switch
            checked={bool(o, "show_deltas", true)}
            onChange={(v) => onChange({ show_deltas: v })}
            label="Changes since the last issued report"
          />
          <Field
            label="Narrative"
            htmlFor={`${id}-narrative`}
            hint="Plain text; a blank line starts a new paragraph."
          >
            <Textarea
              id={`${id}-narrative`}
              rows={4}
              value={str(o, "narrative", "")}
              onChange={(e) => onChange({ narrative: e.target.value })}
            />
          </Field>
        </div>
      );
    case "findings_table":
      return (
        <div className="flex flex-col gap-3">
          <Field label="Sort by" htmlFor={`${id}-sort`}>
            <Select
              id={`${id}-sort`}
              value={str(o, "sort", "severity_desc")}
              onChange={(e) => onChange({ sort: e.target.value })}
            >
              {TABLE_SORTS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <CheckGroup
            legend="Columns"
            items={TABLE_COLUMNS}
            keepOne
            value={list(
              o,
              "columns",
              TABLE_COLUMNS.slice(0, 7).map(([v]) => v),
            )}
            onChange={(columns) => onChange({ columns })}
          />
        </div>
      );
    case "finding_pages":
      return (
        <div className="flex flex-col gap-3">
          <CheckGroup
            legend="Snapshots"
            items={SNAPSHOT_KINDS}
            value={list(o, "snapshots", ["image", "map", "cloud"])}
            onChange={(snapshots) => onChange({ snapshots })}
          />
          <Field label="Photos per finding" htmlFor={`${id}-photos`} hint="0 leaves the photos out.">
            <Input
              id={`${id}-photos`}
              type="number"
              min={0}
              max={6}
              dense
              className="w-20"
              value={num(o, "photos_max", 4)}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (Number.isFinite(n)) onChange({ photos_max: Math.min(6, Math.max(0, n)) });
              }}
            />
          </Field>
          <Field
            label="Pages for"
            htmlFor={`${id}-min-severity`}
            hint="The findings table still lists every finding."
          >
            <Select
              id={`${id}-min-severity`}
              value={typeof o.min_severity === "number" ? String(o.min_severity) : ""}
              onChange={(e) => onChange({ min_severity: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Every finding</option>
              {scale.map((l) => (
                <option key={l.level} value={l.level}>
                  {`${l.name} and above`}
                </option>
              ))}
            </Select>
          </Field>
          <Segmented<Comments>
            label="Comments"
            size="sm"
            options={[
              { value: "none", label: "None" },
              { value: "last", label: "Last" },
              { value: "all", label: "All" },
            ]}
            value={str(o, "comments", "last") as Comments}
            onChange={(comments) => onChange({ comments })}
          />
          <Switch
            checked={bool(o, "context_inset", true)}
            onChange={(v) => onChange({ context_inset: v })}
            label="Context inset"
          />
        </div>
      );
    case "asset_summary":
      return (
        <div className="flex flex-col gap-3">
          <Switch
            checked={bool(o, "show_map", true)}
            onChange={(v) => onChange({ show_map: v })}
            label="Findings map"
          />
          <Switch
            checked={bool(o, "show_tables", true)}
            onChange={(v) => onChange({ show_tables: v })}
            label="Zone and side tables"
          />
        </div>
      );
    case "measurements":
      return (
        <div className="flex flex-col gap-3">
          <CheckGroup
            legend="Kinds"
            items={MEASUREMENT_KINDS}
            keepOne
            value={list(
              o,
              "kinds",
              MEASUREMENT_KINDS.map(([v]) => v),
            )}
            onChange={(kinds) => onChange({ kinds })}
          />
          <Switch
            checked={bool(o, "snapshots", true)}
            onChange={(v) => onChange({ snapshots: v })}
            label="Snapshots"
          />
        </div>
      );
    case "comparison": {
      const pairs = o.pairs;
      return (
        <div className="flex flex-col gap-3">
          <Segmented<Mode>
            label="Comparison layout"
            size="sm"
            options={[
              { value: "swipe", label: "Swipe" },
              { value: "side_by_side", label: "Side by side" },
              { value: "both", label: "Both" },
            ]}
            value={str(o, "mode", "both") as Mode}
            onChange={(mode) => onChange({ mode })}
          />
          <Switch
            checked={bool(o, "counts_chart", true)}
            onChange={(v) => onChange({ counts_chart: v })}
            label="Counts over time"
          />
          <p className="text-xs text-muted">
            {Array.isArray(pairs) ? `Pairs: ${pairs.length} from the template` : "Pairs: automatic"}
          </p>
        </div>
      );
    }
    case "object_counts":
      return (
        <div className="flex flex-col gap-3">
          <Switch
            checked={bool(o, "per_area", true)}
            onChange={(v) => onChange({ per_area: v })}
            label="Per site area"
          />
          <Switch
            checked={bool(o, "verified_only", false)}
            onChange={(v) => onChange({ verified_only: v })}
            label="Verified only"
          />
        </div>
      );
    case "appendix":
      return (
        <Switch
          checked={bool(o, "include_methods", true)}
          onChange={(v) => onChange({ include_methods: v })}
          label="Method notes"
        />
      );
    default:
      return null;
  }
}
