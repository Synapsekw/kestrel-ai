import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useApi } from "@/api/client";
import { listDataItems, type DataItem, type DataItemType } from "@/api/dataItems";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { STATUSES, STATUS_LABEL } from "@/findings/status";
import { useProjectTypes } from "@/findings/useProjectTypes";
import {
  Checkbox,
  Field,
  Icon,
  Input,
  Select,
  cx,
  focusRing,
  pressable,
  transition,
  useSeverityScale,
  type IconName,
} from "@/ui";
import {
  DATA_ITEMS_LIMIT,
  allTypes,
  setDate,
  setDateRule,
  setSeverityMin,
  toggleDataItem,
  toggleStatus,
  toggleType,
  type DateRule,
  type Filters,
} from "./builderModel";
import { matchLine } from "./format";

/** The contract's bound on `filters.date.days` (ReportDateFilter: 1 to 3650). */
const MAX_DAYS = 3650;

const DATA_ICON: Record<DataItemType, IconName> = {
  image_set: "images",
  map: "map",
  elevation: "elevation",
  drawing: "drawing",
  point_cloud: "cloud",
  asset_model: "cube",
};

const DATE_RULES: { value: DateRule; label: string }[] = [
  { value: "all", label: "All dates" },
  { value: "range", label: "Between two dates" },
  { value: "last_days", label: "Last N days" },
  { value: "since_last_issued", label: "Since the last issued version" },
];

function Chip({
  pressed,
  onClick,
  colour,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  colour?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      style={colour ? ({ "--c": colour } as CSSProperties) : undefined}
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-chip border px-2.5 text-xs",
        focusRing,
        transition,
        pressable,
        pressed
          ? "border-line-strong bg-surface-2 text-ink"
          : "border-line text-muted hover:bg-hover hover:text-ink",
      )}
    >
      {colour && <span aria-hidden className="h-2 w-2 rounded-full bg-[color:var(--c)]" />}
      {children}
    </button>
  );
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-xs font-medium text-muted">{legend}</legend>
      {children}
    </fieldset>
  );
}

/** The Data list for the data-item filter: one bounded page (Budget), like `useDataLabels`. */
function useDataItems(projectId: string): DataItem[] {
  const api = useApi();
  const [items, setItems] = useState<{ projectId: string; items: DataItem[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    listDataItems(api, projectId, { limit: DATA_ITEMS_LIMIT }).then(
      (page) => {
        if (!cancelled) setItems({ projectId, items: page.items });
      },
      (e: unknown) => pushLog(`data list unavailable: ${messageOf(e, String(e))}`),
    );
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return items?.projectId === projectId ? items.items : [];
}

export interface ReportFiltersProps {
  projectId: string;
  filters: Filters;
  onChange: (filters: Filters) => void;
  /** `outline.finding_count`, or null while an edit is unsaved (Ruling 2). */
  matchCount: number | null;
  /** `YYYY-MM-DD`; seeds a new date range. */
  today?: string;
}

/**
 * Spec §12 ReportFilters: severity floor, statuses, types, date rule, data items, and the live
 * count. Renders no region of its own; `ReportSettings` wraps it in the region `Filters`.
 *
 * Ruling R-7.1 (coordinator ruling, overrides the plan): choosing a severity level sets
 * `include_ungraded: false` (via `setSeverityMin`); a Checkbox "Include ungraded findings" lets the
 * operator turn it back on without changing the floor, and only appears while a level is chosen,
 * "Any" has no ungraded concept, so the control disappears with it.
 */
export function ReportFilters({
  projectId,
  filters,
  onChange,
  matchCount,
  today = new Date().toISOString().slice(0, 10),
}: ReportFiltersProps) {
  const scale = useSeverityScale();
  const { all: types } = useProjectTypes(projectId);
  const dataItems = useDataItems(projectId);
  const date = filters.date;
  const chosenData = filters.data_item_ids ?? [];

  return (
    <div className="flex flex-col gap-4">
      <p role="status" aria-live="polite" className="text-sm font-medium text-ink">
        {matchLine(matchCount)}
      </p>

      <Group legend="Severity at least">
        <div className="flex flex-wrap gap-1.5">
          <Chip
            pressed={filters.severity_min === null}
            onClick={() => onChange(setSeverityMin(filters, null))}
          >
            Any
          </Chip>
          {scale.map((l) => (
            <Chip
              key={l.level}
              colour={l.colour}
              pressed={filters.severity_min === l.level}
              onClick={() => onChange(setSeverityMin(filters, l.level))}
            >
              {l.name}
            </Chip>
          ))}
        </div>
        {filters.severity_min !== null && (
          <Checkbox
            label="Include ungraded findings"
            checked={filters.include_ungraded}
            onChange={(e) => onChange({ ...filters, include_ungraded: e.target.checked })}
          />
        )}
      </Group>

      <Group legend="Status">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {STATUSES.map((s) => (
            <Checkbox
              key={s}
              label={STATUS_LABEL[s]}
              checked={filters.statuses.includes(s)}
              onChange={() => onChange(toggleStatus(filters, s))}
            />
          ))}
        </div>
      </Group>

      <Group legend="Types">
        <div className="flex flex-wrap gap-1.5">
          <Chip pressed={filters.type_ids === null} onClick={() => onChange(allTypes(filters))}>
            All types
          </Chip>
          {types.map((t) => (
            <Chip
              key={t.id}
              colour={t.colour}
              pressed={filters.type_ids?.includes(t.id) ?? false}
              onClick={() => onChange(toggleType(filters, t.id))}
            >
              {t.name}
            </Chip>
          ))}
        </div>
      </Group>

      <div className="flex flex-col gap-2">
        <Field label="Date" htmlFor="report-date-rule">
          <Select
            id="report-date-rule"
            value={date.rule}
            onChange={(e) => onChange(setDateRule(filters, e.target.value as DateRule, today))}
          >
            {DATE_RULES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        {date.rule === "range" && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="From" htmlFor="report-date-from">
              <Input
                id="report-date-from"
                type="date"
                dense
                value={date.from ?? ""}
                onChange={(e) => onChange(setDate(filters, { from: e.target.value || null }))}
              />
            </Field>
            <Field label="To" htmlFor="report-date-to">
              <Input
                id="report-date-to"
                type="date"
                dense
                value={date.to ?? ""}
                onChange={(e) => onChange(setDate(filters, { to: e.target.value || null }))}
              />
            </Field>
          </div>
        )}
        {date.rule === "last_days" && (
          <Field label="Days" htmlFor="report-date-days">
            <Input
              id="report-date-days"
              type="number"
              min={1}
              max={MAX_DAYS}
              dense
              className="w-24"
              value={date.days ?? 30}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (Number.isFinite(n) && n >= 1) onChange(setDate(filters, { days: Math.min(MAX_DAYS, n) }));
              }}
            />
          </Field>
        )}
        {date.rule === "since_last_issued" && (
          <p className="text-xs text-muted">
            Findings observed after this report&apos;s newest issued version.
          </p>
        )}
        <p className="text-2xs text-muted">
          A finding&apos;s date is when its data was captured, else when it was created.
        </p>
      </div>

      <Group legend="Data items">
        <p className="-mt-1 text-2xs text-muted">None ticked: every data item.</p>
        <ul className="flex flex-col gap-1.5">
          {dataItems.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <Checkbox
                label={d.label}
                checked={chosenData.includes(d.id)}
                onChange={() => onChange(toggleDataItem(filters, d.id))}
                className="min-w-0 flex-1"
              />
              <Icon name={DATA_ICON[d.type]} size={14} className="shrink-0 text-dim" />
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}
