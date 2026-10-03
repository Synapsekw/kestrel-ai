import { useEffect, useId, useMemo, useState } from "react";
import type { AssetItemRow } from "@/api/plantItems";
import {
  Alert,
  Button,
  EmptyState,
  Input,
  Pill,
  Select,
  Skeleton,
  computeWindow,
  cx,
  focusRing,
  useVirtualRows,
} from "@/ui";
import { FLAG_CODES, FLAG_TEXT, type FlagCode } from "./itemFormat";
import { useRegister } from "./useRegister";

const ROW_H = 44;
/** Rows from the end at which the next page is asked for. */
const AHEAD = 30;
/** The pause after the last keystroke before the register is asked (same as the command palette). */
const SEARCH_DEBOUNCE_MS = 120;
const fmt = new Intl.NumberFormat("en-GB");

export interface RegisterPanelProps {
  projectId: string;
  modelId: string;
  version: number;
  /** Type filter options: the builder catalogue's types (Ruling 16). */
  catalogueTypes: readonly string[];
  /** The selected item's node (its id). */
  selectedId: string | null;
  onPick(node: string): void;
}

/** Spec section 11 Register (right): search by tag or name, filter by area, type and flag, fly to a row. */
export function RegisterPanel(p: RegisterPanelProps) {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [area, setArea] = useState("");
  const [flag, setFlag] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setQ(text), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [text]);
  const reg = useRegister(p.projectId, p.modelId, p.version, {
    q,
    type,
    area,
    flag: (flag || undefined) as FlagCode | undefined,
  });
  // Area options: every area seen so far (filtering narrows the rows, not the choices) plus the current one.
  const [seenAreas, setSeenAreas] = useState<readonly string[]>([]);
  const areas = useMemo(() => {
    const s = new Set([
      ...seenAreas,
      ...reg.rows.map((r) => r.area).filter((a): a is string => !!a),
      ...(area ? [area] : []),
    ]);
    return [...s].sort();
  }, [seenAreas, reg.rows, area]);
  const { containerRef, onScroll: syncScroll, height, scrollTop } = useVirtualRows({ rowHeight: ROW_H });
  const win = computeWindow(scrollTop, height, ROW_H, reg.rows.length);
  const ids = { type: useId(), area: useId(), flag: useId() };
  const filtered = !!(q || type || area || flag);
  // A new query starts at the top of its list.
  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = 0;
    syncScroll();
  }, [q, type, area, flag, containerRef, syncScroll]);

  const onScroll = () => {
    syncScroll();
    const el = containerRef.current;
    if (el && el.scrollTop + el.clientHeight >= (reg.rows.length - AHEAD) * ROW_H) reg.loadMore();
  };

  return (
    <section aria-label="Register" className="flex min-h-0 flex-1 flex-col gap-2">
      <Input
        type="search"
        aria-label="Search the register"
        placeholder="Search by tag or name"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="grid grid-cols-3 gap-1.5">
        <label htmlFor={ids.type} className="sr-only">
          Type
        </label>
        <Select id={ids.type} dense value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {p.catalogueTypes.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
        <label htmlFor={ids.area} className="sr-only">
          Area
        </label>
        <Select
          id={ids.area}
          dense
          value={area}
          onChange={(e) => {
            setSeenAreas(areas);
            setArea(e.target.value);
          }}
        >
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <label htmlFor={ids.flag} className="sr-only">
          Flag
        </label>
        <Select id={ids.flag} dense value={flag} onChange={(e) => setFlag(e.target.value)}>
          <option value="">Any flag</option>
          {FLAG_CODES.map((f) => (
            <option key={f} value={f}>
              {FLAG_TEXT[f]}
            </option>
          ))}
        </Select>
      </div>
      <p className="font-mono text-2xs tabular-nums text-muted">
        {`${fmt.format(reg.rows.length)}${reg.done ? "" : "+"} item${reg.rows.length === 1 ? "" : "s"}`}
      </p>
      {reg.error && (
        <Alert
          tone="danger"
          title="The register could not be loaded."
          actions={
            <Button size="sm" icon="refresh" onClick={reg.retry}>
              Retry
            </Button>
          }
        >
          <p className="text-xs text-muted">{reg.error}</p>
        </Alert>
      )}
      {reg.rows.length === 0 && reg.loading && (
        <div role="status" aria-label="Loading the register" className="flex flex-col gap-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-sm" />
          ))}
        </div>
      )}
      {reg.rows.length === 0 && reg.done && (
        <EmptyState icon="list" title={filtered ? "No items match" : "This version has no items yet"}>
          {filtered ? "Clear the search or a filter to see more." : "A plant run or an edit adds them."}
        </EmptyState>
      )}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto rounded-control bg-glass-solid"
      >
        <ul aria-label="Register items" style={{ height: win.totalHeight }} className="relative">
          {reg.rows.slice(win.start, win.end).map((r: AssetItemRow, i) => {
            const flags = (r.flags ?? []).length;
            const selected = r.node === p.selectedId;
            return (
              <li
                key={r.node}
                className="absolute inset-x-0"
                style={{ top: (win.start + i) * ROW_H, height: ROW_H }}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => p.onPick(r.node)}
                  className={cx(
                    "flex h-full w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-hover",
                    selected && "bg-accent-soft",
                    focusRing,
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cx("font-mono text-xs", r.tag ? "text-ink" : "text-dim")}>
                      {r.tag ?? "Untagged"}
                    </span>
                    <span className="truncate text-xs text-muted">{r.name}</span>
                  </span>
                  <span className="shrink-0 text-2xs text-dim">{r.type.replace(/_/g, " ")}</span>
                  {flags > 0 && <Pill size="sm" tone="warn">{`${flags} flag${flags === 1 ? "" : "s"}`}</Pill>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
