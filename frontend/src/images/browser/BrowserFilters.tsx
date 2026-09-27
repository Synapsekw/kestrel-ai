import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Source } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchAllSources } from "@/api/sources";
import { pushLog } from "@/app/diagnostics";
import { STATUSES, STATUS_LABEL } from "@/findings/status";
import { useProjectTypes } from "@/findings/useProjectTypes";
import {
  Checkbox,
  cx,
  Disclosure,
  focusRing,
  IconButton,
  Input,
  Segmented,
  Select,
  Switch,
  transition,
  useSeverityScale,
} from "@/ui";
import {
  moreFilterCount,
  SORT_LABEL,
  toggleSeverity,
  type BrowserFilterState,
  type BrowserSort,
  type FindingStatusFilter,
  type TriState,
} from "./filters";
import type { ImageIndexState } from "./useImageIndex";

export const SEARCH_COMMIT_MS = 250;

export interface BrowserFiltersProps {
  projectId: string;
  value: BrowserFilterState;
  onChange: (next: BrowserFilterState) => void;
  /** The current index, for the chips' counts (images by worst severity). */
  index: Pick<ImageIndexState, "sev" | "total">;
}

export function severityHistogram(sev: readonly number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const s of sev) m.set(s, (m.get(s) ?? 0) + 1);
  return m;
}

const SORTS = Object.keys(SORT_LABEL) as BrowserSort[];

function useSources(projectId: string): Source[] {
  const api = useApi();
  const [loaded, setLoaded] = useState<{ projectId: string; items: Source[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAllSources(api, projectId).then(
      (items) => {
        if (!cancelled) setLoaded({ projectId, items: items.filter((s) => s.kind !== "map") });
      },
      (e: unknown) => pushLog(`sources unavailable: ${messageOf(e, String(e))}`),
    );
    return () => {
      cancelled = true;
    };
  }, [api, projectId]);
  return loaded?.projectId === projectId ? loaded.items : [];
}

/** Search commits after a pause, so typing does not re-read the index per keystroke. */
function SearchField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Input
      type="search"
      dense
      aria-label="Search file names"
      placeholder="Search file names"
      value={text}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        if (timer.current !== null) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onCommit(v), SEARCH_COMMIT_MS);
      }}
    />
  );
}

/** Spec §6.1: flight, has findings + status, severity chips, and "More". */
export function BrowserFilters({ projectId, value, onChange, index }: BrowserFiltersProps) {
  const sources = useSources(projectId);
  const { all: types } = useProjectTypes(projectId);
  const scale = useSeverityScale();
  const counts = severityHistogram(index.sev);
  const set = (patch: Partial<BrowserFilterState>) => onChange({ ...value, ...patch });
  const filtering = value.severities.length > 0;
  const more = moreFilterCount(value);

  return (
    <div className="flex flex-col gap-2">
      <Select
        dense
        aria-label="Flight"
        value={value.sourceId}
        onChange={(e) => set({ sourceId: e.target.value })}
      >
        <option value="">All flights · {sources.reduce((n, s) => n + s.image_count, 0)}</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {`${s.label ?? s.folder} · ${s.image_count}`}
          </option>
        ))}
      </Select>

      <div className="flex items-center gap-2">
        <Switch label="Has findings" checked={value.hasFindings} onChange={(v) => set({ hasFindings: v })} />
        <Select
          dense
          aria-label="Finding status"
          wrapperClassName="ml-auto w-28"
          value={value.findingStatus}
          onChange={(e) => set({ findingStatus: e.target.value as FindingStatusFilter })}
        >
          <option value="all">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Severity">
        {[...scale]
          .sort((a, b) => b.level - a.level)
          .map((l) => {
            const on = value.severities.includes(l.level);
            const n = counts.get(l.level) ?? 0;
            return (
              <button
                key={l.level}
                type="button"
                data-level={l.level}
                aria-pressed={on}
                onClick={() => onChange(toggleSeverity(value, l.level))}
                style={{ "--c": l.colour } as CSSProperties}
                className={cx(
                  "inline-flex h-6 items-center gap-1.5 rounded-chip border px-2 text-2xs",
                  on
                    ? "border-accent bg-accent-soft text-ink"
                    : "border-line bg-surface-2 text-muted hover:text-ink",
                  transition,
                  focusRing,
                )}
              >
                <span aria-hidden className="h-2 w-2 rounded-full bg-[color:var(--c)]" />
                {l.name}
                {(!filtering || on) && <span className="font-mono text-ink">{n}</span>}
              </button>
            );
          })}
      </div>

      <Disclosure label="More" summary={more > 0 ? `${more} on` : undefined}>
        <div className="flex flex-col gap-2">
          <SearchField value={value.search} onCommit={(v) => set({ search: v })} />
          <Switch
            label="Has suggestions"
            checked={value.hasSuggestions}
            onChange={(v) => set({ hasSuggestions: v })}
          />
          <Segmented<TriState>
            size="sm"
            label="Reviewed"
            value={value.reviewed}
            onChange={(v) => set({ reviewed: v })}
            options={[
              { value: "all", label: "All" },
              { value: "yes", label: "Reviewed" },
              { value: "no", label: "Not reviewed" },
            ]}
          />
          <Switch label="Unlabeled" checked={value.unlabeled} onChange={(v) => set({ unlabeled: v })} />
          {types.length > 0 && (
            <fieldset className="flex max-h-40 flex-col gap-1 overflow-auto">
              <legend className="mb-1 text-2xs text-muted">Types</legend>
              {types.map((t) => (
                <Checkbox
                  key={t.id}
                  label={t.name}
                  checked={value.typeIds.includes(t.id)}
                  onChange={(e) =>
                    set({
                      typeIds: e.target.checked
                        ? [...value.typeIds, t.id]
                        : value.typeIds.filter((id) => id !== t.id),
                    })
                  }
                />
              ))}
            </fieldset>
          )}
          <div className="flex items-center gap-2">
            <Select
              dense
              aria-label="Sort"
              value={value.sort}
              onChange={(e) => set({ sort: e.target.value as BrowserSort })}
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {`By ${SORT_LABEL[s]}`}
                </option>
              ))}
            </Select>
            <IconButton
              size="sm"
              icon={value.order === "asc" ? "arrow-left" : "arrow-right"}
              label={value.order === "asc" ? "Sort descending" : "Sort ascending"}
              onClick={() => set({ order: value.order === "asc" ? "desc" : "asc" })}
              className={value.order === "asc" ? "rotate-90" : "-rotate-90"}
            />
          </div>
        </div>
      </Disclosure>
    </div>
  );
}
