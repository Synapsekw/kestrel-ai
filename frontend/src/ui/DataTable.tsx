import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Checkbox } from "./Checkbox";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { isTypingTarget } from "./keymap";
import { SkeletonRows } from "./Skeleton";
import { cx } from "./tokens";
import { computeWindow, useVirtualRows } from "./useVirtualRows";

/** Every row is this tall; the window arithmetic depends on it (spec §4.4). */
export const ROW_HEIGHT = 44;

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** A CSS grid track: "44px", "minmax(0,2fr)", "120px". Default minmax(0,1fr). */
  width?: string;
  render: (row: T, index: number) => ReactNode;
  sortable?: boolean;
  align?: "start" | "end";
}

export interface Sort {
  key: string;
  dir: "asc" | "desc";
}

export interface DataTableProps<T> {
  label: string;
  columns: readonly Column<T>[];
  /** The loaded pages only; the caller appends a page on onEndReached. */
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** The total across all pages, for aria-rowcount; defaults to the loaded count. */
  total?: number;
  loading?: boolean;
  empty?: ReactNode;
  selected?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
  sort?: Sort | null;
  onSortChange?: (next: Sort) => void;
  onOpen?: (row: T) => void;
  /** The row shown in the inspector. */
  activeKey?: string | null;
  onEndReached?: () => void;
  /** Rows from the end at which onEndReached fires. */
  endThreshold?: number;
  className?: string;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * A virtualised table (Findings, Jobs, Catalogue, Datasets): fixed 44 px rows, only the visible window
 * rendered, a sticky header, checkbox selection with shift-range, keyboard (↑ ↓ J K Home End, Enter
 * opens, Space selects) and cursor paging through onEndReached. Never blurred (spec F7).
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  total,
  loading = false,
  empty,
  selected,
  onSelectionChange,
  sort = null,
  onSortChange,
  onOpen,
  activeKey = null,
  onEndReached,
  endThreshold = 10,
  className,
}: DataTableProps<T>) {
  const selectable = selected !== undefined && onSelectionChange !== undefined;
  const chosen = selected ?? NONE;
  const { containerRef, onScroll, height, scrollTop } = useVirtualRows({ rowHeight: ROW_HEIGHT });
  // The sticky header takes the first row of the viewport.
  const win = computeWindow(Math.max(0, scrollTop - ROW_HEIGHT), height, ROW_HEIGHT, rows.length);
  const [cursor, setCursor] = useState(0);
  const cur = Math.min(cursor, Math.max(0, rows.length - 1));
  const anchor = useRef<number | null>(null);
  const askedAt = useRef(-1);

  useEffect(() => {
    if (!onEndReached || loading || rows.length === 0) return;
    if (win.end >= rows.length - endThreshold && askedAt.current !== rows.length) {
      askedAt.current = rows.length;
      onEndReached();
    }
  }, [win.end, rows.length, loading, onEndReached, endThreshold]);

  const template = [selectable ? "40px" : null, ...columns.map((c) => c.width ?? "minmax(0,1fr)")]
    .filter(Boolean)
    .join(" ");

  const toggle = (i: number, range: boolean) => {
    if (!onSelectionChange) return;
    const next = new Set(chosen);
    const key = rowKey(rows[i]);
    if (range && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      for (let j = a; j <= b; j++) next.add(rowKey(rows[j]));
    } else if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    anchor.current = i;
    onSelectionChange(next);
  };

  /** Scrolls row i into the band below the sticky header. */
  const reveal = (i: number) => {
    const el = containerRef.current;
    if (!el) return;
    const top = i * ROW_HEIGHT;
    const bottom = top + 2 * ROW_HEIGHT;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey || rows.length === 0) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let next: number | null = null;
    if (k === "ArrowDown" || k === "j") next = Math.min(rows.length - 1, cur + 1);
    else if (k === "ArrowUp" || k === "k") next = Math.max(0, cur - 1);
    else if (k === "Home") next = 0;
    else if (k === "End") next = rows.length - 1;
    else if (k === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      onOpen?.(rows[cur]);
      return;
    } else if (k === " " && selectable) {
      e.preventDefault();
      e.stopPropagation();
      toggle(cur, e.shiftKey);
      return;
    }
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    setCursor(next);
    reveal(next);
  };

  const allSelected = selectable && rows.length > 0 && rows.every((r) => chosen.has(rowKey(r)));

  const header = (
    <div
      role="row"
      aria-rowindex={1}
      style={{ gridTemplateColumns: template }}
      className="sticky top-0 z-10 grid h-11 items-center border-b border-line bg-bg/95 text-xs text-muted"
    >
      {selectable && (
        <div role="columnheader" className="flex justify-center">
          <Checkbox
            aria-label="Select all loaded rows"
            checked={allSelected}
            onChange={() => onSelectionChange?.(allSelected ? new Set() : new Set(rows.map(rowKey)))}
          />
        </div>
      )}
      {columns.map((c) => {
        const dir = sort?.key === c.key ? sort.dir : null;
        return (
          <div
            key={c.key}
            role="columnheader"
            aria-sort={
              c.sortable ? (dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none") : undefined
            }
            className={cx("min-w-0 truncate px-3", c.align === "end" && "text-right")}
          >
            {c.sortable && onSortChange ? (
              <button
                type="button"
                onClick={() => onSortChange({ key: c.key, dir: dir === "asc" ? "desc" : "asc" })}
                className="inline-flex items-center gap-1 hover:text-ink"
              >
                {c.header}
                {dir && (
                  <Icon name="chevron-down" size={12} className={dir === "asc" ? "rotate-180" : undefined} />
                )}
              </button>
            ) : (
              c.header
            )}
          </div>
        );
      })}
    </div>
  );

  let body: ReactNode;
  if (rows.length === 0) {
    body = loading ? (
      <SkeletonRows rows={8} columns={Math.min(columns.length, 5)} className="p-3" />
    ) : (
      <div className="px-3">{empty ?? <EmptyState title="Nothing here yet" />}</div>
    );
  } else {
    body = (
      <div role="rowgroup" className="relative" style={{ height: win.totalHeight }}>
        <div style={{ transform: `translateY(${win.offsetTop}px)` }}>
          {rows.slice(win.start, win.end).map((row, j) => {
            const i = win.start + j;
            const key = rowKey(row);
            const isSelected = chosen.has(key);
            return (
              <div
                key={key}
                role="row"
                aria-rowindex={i + 2}
                aria-selected={selectable ? isSelected : undefined}
                data-cursor={i === cur ? "true" : undefined}
                onClick={() => {
                  setCursor(i);
                  onOpen?.(row);
                }}
                style={{ gridTemplateColumns: template }}
                className={cx(
                  "grid h-11 cursor-pointer items-center border-b border-line text-sm text-ink hover:bg-hover",
                  (isSelected || key === activeKey) && "bg-accent-soft",
                  "group-focus-visible:data-[cursor=true]:ring-1 group-focus-visible:data-[cursor=true]:ring-inset group-focus-visible:data-[cursor=true]:ring-accent/60",
                )}
              >
                {selectable && (
                  <div role="gridcell" className="flex justify-center" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select row ${i + 1}`}
                      checked={isSelected}
                      onChange={() => {}}
                      onClick={(e) => toggle(i, e.shiftKey)}
                    />
                  </div>
                )}
                {columns.map((c) => (
                  <div
                    key={c.key}
                    role="gridcell"
                    className={cx("min-w-0 truncate px-3", c.align === "end" && "text-right tabular-nums")}
                  >
                    {c.render(row, i)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      role="grid"
      aria-label={label}
      aria-rowcount={(total ?? rows.length) + 1}
      aria-multiselectable={selectable || undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cx(
        "group relative min-h-0 overflow-auto rounded-panel border border-card-line bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
        className,
      )}
    >
      {header}
      {body}
      {loading && rows.length > 0 && (
        <div role="status" className="flex h-11 items-center px-3 text-xs text-muted">
          Loading more…
        </div>
      )}
    </div>
  );
}
