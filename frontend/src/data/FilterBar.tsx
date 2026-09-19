import { useEffect, useState } from "react";
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

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const label = "flex flex-col gap-0.5 text-xs text-slate-400";

export function FilterBar({ query, onChange, view, onView, sourceNames, total, loaded, onSelectAll }: Props) {
  // The search box owns its text; the query only learns about it after the debounce.
  const [search, setSearch] = useState(query.filters.search);
  useEffect(() => {
    if (search === query.filters.search) return;
    const t = setTimeout(() => onChange({ ...query, filters: { ...query.filters, search } }), 300);
    return () => clearTimeout(t);
  }, [search, query, onChange]);

  const setFilter = <K extends keyof ListQuery["filters"]>(key: K, value: ListQuery["filters"][K]) =>
    onChange({ ...query, filters: { ...query.filters, [key]: value } });

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-slate-800 pb-3">
      <label className={label}>
        Search
        <input
          aria-label="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search file name"
          className={input}
        />
      </label>
      <label className={label}>
        Source
        <select
          aria-label="Source"
          value={query.filters.sourceId}
          onChange={(e) => setFilter("sourceId", e.target.value)}
          className={input}
        >
          <option value="">all</option>
          {Object.entries(sourceNames).map(([id, site]) => (
            <option key={id} value={id}>
              {site}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Group
        <input
          aria-label="Group"
          value={query.filters.groupKey}
          onChange={(e) => setFilter("groupKey", e.target.value)}
          placeholder="flight or tile"
          className={`${input} w-32`}
        />
      </label>
      <label className={label}>
        Labeled
        <select
          aria-label="Labeled"
          value={query.filters.labeled}
          onChange={(e) => setFilter("labeled", e.target.value as TriState)}
          className={input}
        >
          <option value="all">all</option>
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      </label>
      <label className={label}>
        Pending review
        <select
          aria-label="Pending review"
          value={query.filters.pending}
          onChange={(e) => setFilter("pending", e.target.value as TriState)}
          className={input}
        >
          <option value="all">all</option>
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      </label>
      <label className={label}>
        Min boxes
        <input
          aria-label="Min boxes"
          type="number"
          min={0}
          value={query.filters.minBoxes ?? ""}
          onChange={(e) => setFilter("minBoxes", e.target.value === "" ? null : Number(e.target.value))}
          className={`${input} w-20`}
        />
      </label>
      <label className={label}>
        Captured from
        <input
          aria-label="Captured from"
          type="date"
          value={query.filters.captureFrom}
          onChange={(e) => setFilter("captureFrom", e.target.value)}
          className={input}
        />
      </label>
      <label className={label}>
        Captured to
        <input
          aria-label="Captured to"
          type="date"
          value={query.filters.captureTo}
          onChange={(e) => setFilter("captureTo", e.target.value)}
          className={input}
        />
      </label>
      <label className={label}>
        Sort by
        <select
          aria-label="Sort by"
          value={query.sort}
          onChange={(e) => onChange({ ...query, sort: e.target.value as SortKey, order: "asc" })}
          className={input}
        >
          {DATA_COLUMNS.filter((c) => c.sortKey).map((c) => (
            <option key={c.key} value={c.sortKey}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-label="Sort order"
        title={query.order === "asc" ? "ascending" : "descending"}
        onClick={() => onChange({ ...query, order: (query.order === "asc" ? "desc" : "asc") as Order })}
        className="rounded border border-slate-700 px-2 py-1 text-sm hover:bg-slate-800"
      >
        {query.order === "asc" ? "▲" : "▼"}
      </button>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-xs text-slate-400">
          {loaded} of {total} images
        </span>
        {onSelectAll && loaded > 0 && (
          <button
            type="button"
            title="Ctrl+A"
            onClick={onSelectAll}
            className="rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800"
          >
            Select all {loaded}
          </button>
        )}
        {(["grid", "list"] as ViewMode[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            aria-pressed={view === v}
            className={`rounded px-3 py-1 text-sm ${view === v ? "bg-slate-700 text-white" : "border border-slate-700 hover:bg-slate-800"}`}
          >
            {v === "grid" ? "Grid" : "List"}
          </button>
        ))}
      </div>
    </div>
  );
}
