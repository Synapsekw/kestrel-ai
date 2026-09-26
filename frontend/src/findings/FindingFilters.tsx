import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { ClassDef } from "@contract/client";
import type { FindingSummary } from "@/api/findings";
import {
  Button,
  Checkbox,
  Input,
  Popover,
  Segmented,
  Select,
  buttonClass,
  cx,
  focusRing,
  pressable,
  transition,
  type SeverityLevel,
} from "@/ui";
import {
  DEFAULT_FILTERS,
  FINDING_SORTS,
  isFiltered,
  type FindingFilters,
  type FindingSort,
  type SeverityFilter,
  type SourceKind,
} from "./filters";
import { STATUSES, STATUS_LABEL } from "./status";

const SEARCH_DEBOUNCE_MS = 250;
const SORT_LABEL: Record<FindingSort, string> = {
  "-severity": "Severity",
  number: "Number",
  "-updated_at": "Recently updated",
  type: "Type",
};
const SOURCES: SourceKind[] = ["image", "map", "cloud"];
const SOURCE_BUTTON: Record<SourceKind, string> = { image: "Images", map: "Maps", cloud: "Clouds" };

function ToggleChip({
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

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function FindingFiltersBar({
  filters,
  summary,
  scale,
  types,
  onChange,
}: {
  filters: FindingFilters;
  summary: FindingSummary | null;
  scale: readonly SeverityLevel[];
  types: readonly ClassDef[];
  onChange: (next: FindingFilters) => void;
}) {
  const [q, setQ] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  const [typesOpen, setTypesOpen] = useState(false);
  const typesRef = useRef<HTMLButtonElement>(null);
  // A Clear (or a link) changes the URL's q: adopt it while rendering, not in an effect. The URL
  // holds the trimmed text, so a trailing space the user is still typing is not taken back.
  if (seenQ !== filters.q) {
    setSeenQ(filters.q);
    if (q.trim() !== filters.q) setQ(filters.q);
  }
  useEffect(() => {
    if (q.trim() === filters.q) return;
    const t = window.setTimeout(() => onChange({ ...filters, q }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [q, filters, onChange]);

  const total = summary
    ? summary.by_status.open + summary.by_status.reviewed + summary.by_status.closed
    : undefined;
  const severities: { value: SeverityFilter; name: string; colour?: string }[] = [
    ...[...scale]
      .sort((a, b) => b.level - a.level)
      .map((l) => ({ value: l.level, name: l.name, colour: l.colour })),
    { value: "none", name: "No severity" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label="Filter findings">
      <Segmented
        label="Status"
        size="sm"
        value={filters.status ?? "all"}
        onChange={(v) => onChange({ ...filters, status: v === "all" ? null : v })}
        options={[
          { value: "all", label: "All", count: total },
          ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], count: summary?.by_status[s] })),
        ]}
      />
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Severity">
        {severities.map((s) => (
          <ToggleChip
            key={String(s.value)}
            pressed={filters.severity.includes(s.value)}
            colour={s.colour}
            onClick={() => onChange({ ...filters, severity: toggle(filters.severity, s.value) })}
          >
            {s.name}
          </ToggleChip>
        ))}
      </div>
      <button
        ref={typesRef}
        type="button"
        aria-expanded={typesOpen}
        aria-haspopup="dialog"
        onClick={() => setTypesOpen((o) => !o)}
        className={buttonClass("secondary", "sm")}
      >
        {filters.typeIds.length ? `Types · ${filters.typeIds.length}` : "All types"}
      </button>
      <Popover
        open={typesOpen}
        onClose={() => setTypesOpen(false)}
        anchorRef={typesRef}
        label="Filter by type"
      >
        <ul className="flex max-h-72 w-56 flex-col gap-1 overflow-y-auto p-1">
          {types.map((t) => (
            <li key={t.id}>
              <Checkbox
                label={t.name}
                checked={filters.typeIds.includes(t.id)}
                onChange={() => onChange({ ...filters, typeIds: toggle(filters.typeIds, t.id) })}
              />
            </li>
          ))}
          {types.length === 0 && <li className="px-1 text-sm text-muted">This project has no types yet.</li>}
        </ul>
      </Popover>
      <div className="flex items-center gap-1.5" role="group" aria-label="Source">
        {SOURCES.map((s) => (
          <ToggleChip
            key={s}
            pressed={filters.source.includes(s)}
            onClick={() => onChange({ ...filters, source: toggle(filters.source, s) })}
          >
            {SOURCE_BUTTON[s]}
          </ToggleChip>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Input
          type="search"
          dense
          aria-label="Search findings"
          placeholder="Note, type or F-0123"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-56"
        />
        <Select
          dense
          aria-label="Sort findings"
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as FindingSort })}
          wrapperClassName="w-44"
        >
          {FINDING_SORTS.map((s) => (
            <option key={s} value={s}>
              Sort: {SORT_LABEL[s]}
            </option>
          ))}
        </Select>
        {isFiltered(filters) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
