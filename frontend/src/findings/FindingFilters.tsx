import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AssetModel, ClassDef } from "@contract/client";
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
  clearedFilters,
  FINDING_SORTS,
  isFiltered,
  type FindingFilters,
  type FindingSort,
  type PlacedFilter,
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
  "-height": "Height",
  zone: "Zone",
};
/** Asset sorts and the Asset chip show only in a project with asset models. */
const ASSET_SORTS: readonly FindingSort[] = ["-height", "zone"];
const BASE_SOURCES: SourceKind[] = ["image", "map", "cloud"];
const SOURCE_BUTTON: Record<SourceKind, string> = {
  image: "Images",
  map: "Maps",
  cloud: "Clouds",
  asset: "Asset",
};
const PLACED_OPTIONS: { value: PlacedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "placed", label: "Placed" },
  { value: "unplaced", label: "Unplaced" },
];

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

/** Spec section 9 Register: the asset model, its zones and sides (from its review profile), and placement. */
function AssetFilterRow({
  filters,
  models,
  onChange,
}: {
  filters: FindingFilters;
  models: readonly AssetModel[];
  onChange: (next: FindingFilters) => void;
}) {
  const model = models.find((m) => m.id === filters.assetModelId) ?? null;
  const zones = model?.review?.zones ?? [];
  const sides = model?.review?.sides.labels ?? [];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="group" aria-label="Asset filters">
      <Select
        dense
        aria-label="Asset model"
        wrapperClassName="w-52"
        value={filters.assetModelId ?? ""}
        // A zone or side id belongs to one model: a new model starts with none picked.
        onChange={(e) => onChange({ ...filters, assetModelId: e.target.value || null, zone: [], side: [] })}
      >
        <option value="">All asset models</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      {zones.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Zone">
          {zones.map((z) => (
            <ToggleChip
              key={z.id}
              pressed={filters.zone.includes(z.id)}
              onClick={() => onChange({ ...filters, zone: toggle(filters.zone, z.id) })}
            >
              {z.label}
            </ToggleChip>
          ))}
        </div>
      )}
      {sides.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Side">
          {sides.map((s) => (
            <ToggleChip
              key={s}
              pressed={filters.side.includes(s)}
              onClick={() => onChange({ ...filters, side: toggle(filters.side, s) })}
            >
              {s}
            </ToggleChip>
          ))}
        </div>
      )}
      <Segmented<PlacedFilter>
        label="Placement"
        size="sm"
        value={filters.placed}
        onChange={(v) => onChange({ ...filters, placed: v })}
        options={PLACED_OPTIONS}
      />
    </div>
  );
}

const NO_ASSET_MODELS: readonly AssetModel[] = [];

export function FindingFiltersBar({
  filters,
  summary,
  scale,
  types,
  assetModels = NO_ASSET_MODELS,
  onChange,
}: {
  filters: FindingFilters;
  summary: FindingSummary | null;
  scale: readonly SeverityLevel[];
  types: readonly ClassDef[];
  assetModels?: readonly AssetModel[];
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
  const hasAssets = assetModels.length > 0;
  const sources: SourceKind[] = hasAssets ? [...BASE_SOURCES, "asset"] : BASE_SOURCES;
  const sorts = FINDING_SORTS.filter((s) => hasAssets || !ASSET_SORTS.includes(s));

  return (
    <div className="flex flex-col gap-2">
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
            {types.length === 0 && (
              <li className="px-1 text-sm text-muted">This project has no types yet.</li>
            )}
          </ul>
        </Popover>
        <div className="flex items-center gap-1.5" role="group" aria-label="Source">
          {sources.map((s) => (
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
          {/* DS Input is always full width: size it with a wrapper. */}
          <div className="w-56">
            <Input
              type="search"
              dense
              aria-label="Search findings"
              placeholder="Note, type or F-0123"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select
            dense
            aria-label="Sort findings"
            value={filters.sort}
            onChange={(e) => onChange({ ...filters, sort: e.target.value as FindingSort })}
            wrapperClassName="w-44"
          >
            {sorts.map((s) => (
              <option key={s} value={s}>
                Sort: {SORT_LABEL[s]}
              </option>
            ))}
          </Select>
          {isFiltered(filters) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // A search still debouncing would otherwise land again 250 ms after the Clear.
                setQ("");
                onChange(clearedFilters(filters));
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>
      {hasAssets && <AssetFilterRow filters={filters} models={assetModels} onChange={onChange} />}
    </div>
  );
}
