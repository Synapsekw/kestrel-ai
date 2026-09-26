import { useEffect, useId, useState } from "react";
import { Button, Field, Icon, Input, Segmented, Select } from "@/ui";
import {
  DATA_COLUMNS,
  type ListQuery,
  type Order,
  type SortKey,
  type TriState,
  type ViewMode,
} from "./listModel";

interface Props {
  query: ListQuery;
  onChange: (q: ListQuery) => void;
  view: ViewMode;
  onView: (v: ViewMode) => void;
  sourceNames: Record<string, string>;
  total: number;
  loaded: number;
  /** Selects the listed (loaded) images; same as Ctrl+A in the list. */
  onSelectAll?: () => void;
}

const VIEWS = [
  { value: "grid" as const, label: "Grid", icon: "grid" as const },
  { value: "list" as const, label: "List", icon: "list" as const },
];

function TriOptions() {
  return (
    <>
      <option value="all">All</option>
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </>
  );
}

export function FilterBar({ query, onChange, view, onView, sourceNames, total, loaded, onSelectAll }: Props) {
  const id = useId();
  // The search box owns its text; the query only learns about it after the debounce.
  const [search, setSearch] = useState(query.filters.search);
  useEffect(() => {
    if (search === query.filters.search) return;
    const t = setTimeout(() => onChange({ ...query, filters: { ...query.filters, search } }), 300);
    return () => clearTimeout(t);
  }, [search, query, onChange]);

  const setFilter = <K extends keyof ListQuery["filters"]>(key: K, value: ListQuery["filters"][K]) =>
    onChange({ ...query, filters: { ...query.filters, [key]: value } });
  const asc = query.order === "asc";
  const extraCount = [
    query.filters.minBoxes !== null,
    query.filters.captureFrom !== "",
    query.filters.captureTo !== "",
  ].filter(Boolean).length;
  // Folded unless one of them is in use, so the common filters fit on one row.
  const [moreOpen, setMoreOpen] = useState(extraCount > 0);

  return (
    <div className="flex flex-col gap-2 border-b border-line pb-3">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <Field label="Search" htmlFor={`${id}-search`} className="w-52">
          <span className="relative flex">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
            />
            <Input
              id={`${id}-search`}
              dense
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search file name"
              className="pl-7"
            />
          </span>
        </Field>
        <Field label="Source" htmlFor={`${id}-source`} className="w-36">
          <Select
            id={`${id}-source`}
            dense
            value={query.filters.sourceId}
            onChange={(e) => setFilter("sourceId", e.target.value)}
          >
            <option value="">All sources</option>
            {Object.entries(sourceNames).map(([sid, site]) => (
              <option key={sid} value={sid}>
                {site}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Flight or tile" htmlFor={`${id}-group`} className="w-36">
          <Input
            id={`${id}-group`}
            dense
            value={query.filters.groupKey}
            onChange={(e) => setFilter("groupKey", e.target.value)}
            className="font-mono"
          />
        </Field>
        <Field label="Labeled" htmlFor={`${id}-labeled`} className="w-24">
          <Select
            id={`${id}-labeled`}
            dense
            value={query.filters.labeled}
            onChange={(e) => setFilter("labeled", e.target.value as TriState)}
          >
            <TriOptions />
          </Select>
        </Field>
        <Field label="Pending review" htmlFor={`${id}-pending`} className="w-28">
          <Select
            id={`${id}-pending`}
            dense
            value={query.filters.pending}
            onChange={(e) => setFilter("pending", e.target.value as TriState)}
          >
            <TriOptions />
          </Select>
        </Field>
        <div className="flex items-end gap-1">
          <Field label="Sort by" htmlFor={`${id}-sort`} className="w-32">
            <Select
              id={`${id}-sort`}
              dense
              value={query.sort}
              onChange={(e) => onChange({ ...query, sort: e.target.value as SortKey, order: "asc" })}
            >
              {DATA_COLUMNS.filter((c) => c.sortKey).map((c) => (
                <option key={c.key} value={c.sortKey}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            size="sm"
            aria-label="Sort order"
            title={asc ? "Ascending" : "Descending"}
            onClick={() => onChange({ ...query, order: (asc ? "desc" : "asc") as Order })}
            className="w-7 px-0"
          >
            <Icon name="chevron-down" size={14} className={asc ? "rotate-180" : undefined} />
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={moreOpen}
          aria-controls={`${id}-more`}
          onClick={() => setMoreOpen((o) => !o)}
        >
          <Icon
            name="chevron-right"
            size={14}
            className={
              moreOpen ? "rotate-90 transition-transform duration-fast" : "transition-transform duration-fast"
            }
          />
          More filters
          {extraCount > 0 && (
            <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent-soft px-1 text-[11px] font-semibold text-accent-ink">
              {extraCount}
            </span>
          )}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[13px] tabular-nums text-muted">
            {loaded} of {total} images
          </span>
          {onSelectAll && loaded > 0 && (
            <Button variant="ghost" size="sm" title="Ctrl+A" onClick={onSelectAll}>
              Select all {loaded}
            </Button>
          )}
          <Segmented label="View" options={VIEWS} value={view} onChange={onView} />
        </div>
      </div>
      {moreOpen && (
        <div
          id={`${id}-more`}
          className="flex flex-wrap items-end gap-x-3 gap-y-2 animate-reveal reduce-motion:animate-none"
        >
          <Field label="Min boxes" htmlFor={`${id}-min`} className="w-20">
            <Input
              id={`${id}-min`}
              dense
              type="number"
              min={0}
              value={query.filters.minBoxes ?? ""}
              onChange={(e) => setFilter("minBoxes", e.target.value === "" ? null : Number(e.target.value))}
              className="tabular-nums"
            />
          </Field>
          <Field label="Captured from" htmlFor={`${id}-from`} className="w-36">
            <Input
              id={`${id}-from`}
              dense
              type="date"
              value={query.filters.captureFrom}
              onChange={(e) => setFilter("captureFrom", e.target.value)}
            />
          </Field>
          <Field label="Captured to" htmlFor={`${id}-to`} className="w-36">
            <Input
              id={`${id}-to`}
              dense
              type="date"
              value={query.filters.captureTo}
              onChange={(e) => setFilter("captureTo", e.target.value)}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
